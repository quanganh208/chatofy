/**
 * The two WebRTC connections one call attempt holds with Cloudflare Realtime SFU.
 *
 * One connection publishes this client's microphone and camera; the other
 * receives everyone else's. The API drives the SFU, so every negotiation is a
 * request on the conference socket. Receiving is a delta the server works out:
 * `conference.media.subscribe {}` brings the receiving connection up to date
 * with the room, and a repeat with nothing new comes back as `sdp: null`.
 */
import { z } from 'zod';
import {
  ConferenceMediaSubscribeReplySchema,
  MAX_CONFERENCE_SDP_CHARS,
} from '@chatofy/types/events';
import { conferenceDebug } from './conference-debug-log';
import { request } from './conference-signaling';
import { SerialChain } from './serial-chain';
import {
  dropPeer,
  peerForMid,
  publishTracksFromTransceivers,
  recordMids,
  type MidMap,
} from './sfu-mid-map';

const publishReplySchema = z.object({ sdp: z.string().min(1).max(MAX_CONFERENCE_SDP_CHARS) });

export interface ConferenceSfuMediaOptions {
  /** The conference socket the attempt joined on. */
  ws: WebSocket;
  /** From the join reply: STUN, and TURN when the server has it configured. */
  iceServers: RTCIceServer[];
  /** A remote peer's track arrived on the receiving connection. */
  onTrack: (socketId: string, track: MediaStreamTrack) => void;
}

export class ConferenceSfuMedia {
  private readonly pubPc: RTCPeerConnection;
  private readonly subPc: RTCPeerConnection;
  private readonly mids: MidMap = new Map();
  /** Subscribes run one at a time: the SFU refuses an offer while one is unanswered. */
  private readonly subscribes = new SerialChain();
  private closed = false;

  constructor(private readonly options: ConferenceSfuMediaOptions) {
    const config: RTCConfiguration = { bundlePolicy: 'max-bundle', iceServers: options.iceServers };
    this.pubPc = new RTCPeerConnection(config);
    this.subPc = new RTCPeerConnection(config);
    this.subPc.ontrack = (event) => {
      const peer = peerForMid(this.mids, event.transceiver.mid);
      if (!peer) {
        conferenceDebug(`track on unknown mid ${String(event.transceiver.mid)}`);
        return;
      }
      options.onTrack(peer.socketId, event.track);
    };
  }

  /**
   * Publish the local tracks. Rejects with `ConferenceRequestError` when the
   * gateway refuses, which fails the attempt like any other refused step.
   */
  async publish(stream: MediaStream): Promise<void> {
    for (const track of stream.getTracks()) {
      this.pubPc.addTransceiver(track, { direction: 'sendonly' });
    }
    await this.pubPc.setLocalDescription(await this.pubPc.createOffer());
    const sdp = this.pubPc.localDescription?.sdp;
    if (!sdp) throw new Error('publishing connection has no local offer');
    const tracks = publishTracksFromTransceivers(this.pubPc.getTransceivers());
    const reply = publishReplySchema.parse(
      await request(this.options.ws, 'conference.media.publish', { sdp, tracks }),
    );
    if (this.closed) return;
    await this.pubPc.setRemoteDescription({ type: 'answer', sdp: reply.sdp });
  }

  /** Queue one catch-up with the room. Duplicates are harmless. */
  subscribe(): void {
    this.subscribes.enqueue(
      () => this.subscribeOnce(),
      (err: unknown) => conferenceDebug(`subscribe failed: ${String(err)}`),
    );
  }

  /** Resolves once every subscribe queued so far has settled. */
  settled(): Promise<void> {
    return this.subscribes.drained();
  }

  /**
   * Forget a departed peer's mids. No renegotiation: the server closes those
   * mids on the SFU itself.
   */
  forgetPeer(socketId: string): void {
    dropPeer(this.mids, socketId);
  }

  /** Close both connections. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subPc.ontrack = null;
    this.pubPc.close();
    this.subPc.close();
    this.mids.clear();
  }

  private async subscribeOnce(): Promise<void> {
    if (this.closed) return;
    const { ws } = this.options;
    const reply = ConferenceMediaSubscribeReplySchema.parse(
      await request(ws, 'conference.media.subscribe', {}),
    );
    if (reply.sdp === null || this.closed) return;
    // Before the offer is applied: its track events fire during
    // setRemoteDescription and are matched to a peer by mid.
    recordMids(this.mids, reply.mids);
    await this.subPc.setRemoteDescription({ type: 'offer', sdp: reply.sdp });
    await this.subPc.setLocalDescription(await this.subPc.createAnswer());
    const answer = this.subPc.localDescription?.sdp;
    if (!answer) throw new Error('receiving connection has no local answer');
    await request(ws, 'conference.media.renegotiate', { sdp: answer });
  }
}
