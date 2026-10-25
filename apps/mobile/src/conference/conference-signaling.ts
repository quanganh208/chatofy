/**
 * The Cloudflare Realtime SFU publish and subscribe steps that ride on the
 * `/ws/conference` request/reply helpers (conference-request.ts, re-exported
 * here). Module-level helpers, no React.
 *
 * A call owns two RTCPeerConnections, each backed by one SFU session the API
 * drives on this client's behalf: a send connection that publishes the local
 * tracks once, and a receive connection the server keeps up to date with the
 * room. Every subscribe on the receive connection runs on one serial chain, so
 * an offer is always answered before the next one is asked for.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import {
  MediaStream,
  RTCPeerConnection,
  type MediaStreamTrack,
  type RTCRtpTransceiver,
} from 'react-native-webrtc';
import {
  ConferenceMediaSubscribeReplySchema,
  type ConferenceIceServer,
} from '@chatofy/types/events';
import { ConferenceRequestError, request, type SignalSocket } from './conference-request';
import {
  dropPeer,
  peerForMid,
  publishTracksFromTransceivers,
  recordMids,
  type SfuMidMap,
} from './sfu-mid-map';

export {
  ConferenceRequestError,
  parseSignal,
  replyErrorCode,
  request,
  send,
  type SignalMessage,
} from './conference-request';

/** Both SFU connections bundle every m-line onto one transport, as Cloudflare's examples do. */
export function createSfuPeerConnection(iceServers: ConferenceIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceServers });
}

function sdpOf(data: unknown, event: string): string {
  const sdp = (data as { sdp?: unknown } | null)?.sdp;
  if (typeof sdp !== 'string' || sdp.length === 0) throw new Error(`${event} returned no sdp`);
  return sdp;
}

/**
 * Publish `tracks` on the send connection: one sendonly transceiver per track,
 * the offer and its `{ mid, kind }` list to the gateway, and the SFU's answer
 * back. A refusal or a timeout rejects, which fails the join like a refused
 * produce did.
 */
export async function publishLocalTracks(
  ws: SignalSocket,
  pc: RTCPeerConnection,
  tracks: MediaStreamTrack[],
): Promise<void> {
  for (const track of tracks) pc.addTransceiver(track, { direction: 'sendonly' });
  await pc.setLocalDescription(await pc.createOffer());
  const offer = pc.localDescription?.sdp;
  if (!offer) throw new Error('send connection has no local offer');
  const reply = await request(ws, 'conference.media.publish', {
    sdp: offer,
    tracks: publishTracksFromTransceivers(pc.getTransceivers()),
  });
  await pc.setRemoteDescription({ type: 'answer', sdp: sdpOf(reply, 'conference.media.publish') });
}

/**
 * The `track` event react-native-webrtc dispatches on a connection. 124.0.8
 * publishes its typings without the vendored event-target-shim declarations,
 * so `RTCPeerConnection` loses `addEventListener` at the type level although
 * the runtime has it; the listener is registered through this narrow view.
 */
interface TrackEventTarget {
  addEventListener(
    type: 'track',
    listener: (event: {
      track: MediaStreamTrack | null;
      transceiver: RTCRtpTransceiver | undefined;
    }) => void,
  ): void;
}

export interface SfuSubscriber {
  /** Bring the receive connection up to date with the room. Duplicates are harmless. */
  subscribe: () => void;
  /** Forget a departed peer's mids. The server closes them; no renegotiation here. */
  dropPeer: (socketId: string) => void;
  /** Close the receive connection; queued subscribes become no-ops. */
  close: () => void;
}

/**
 * The receive connection and its serial subscribe chain. Each received track
 * is handed to `onTrack` in a fresh native MediaStream under the socketId the
 * subscribe reply named for its `mid`.
 */
export function createSfuSubscriber(
  ws: SignalSocket,
  iceServers: ConferenceIceServer[],
  onTrack: (socketId: string, stream: MediaStream) => void,
): SfuSubscriber {
  const pc = createSfuPeerConnection(iceServers);
  const midToPeer: SfuMidMap = new Map();
  // A renegotiation can re-announce a receiver it already reported; attach once.
  const attachedTracks = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let closed = false;

  (pc as unknown as TrackEventTarget).addEventListener('track', (event) => {
    if (closed) return;
    const track = event.track;
    if (!track || attachedTracks.has(track.id)) return;
    // react-native-webrtc sets the transceiver on the event; fall back to the
    // connection's own transceiver list, matched by the received track.
    const mid =
      event.transceiver?.mid ??
      pc.getTransceivers().find((t) => t.receiver.track?.id === track.id)?.mid ??
      null;
    const owner = mid === null ? undefined : peerForMid(midToPeer, mid);
    if (!owner) {
      console.warn('[conference] received a track on an unknown mid', mid);
      return;
    }
    attachedTracks.add(track.id);
    const stream = new MediaStream();
    stream.addTrack(track);
    onTrack(owner.socketId, stream);
  });

  async function runSubscribe(): Promise<void> {
    const raw = await request(ws, 'conference.media.subscribe', {});
    if (closed) return;
    const parsed = ConferenceMediaSubscribeReplySchema.safeParse(raw);
    if (!parsed.success) throw new Error('conference.media.subscribe returned an unexpected shape');
    const { sdp, mids } = parsed.data;
    if (sdp === null) return;
    // Track events fire before setRemoteDescription resolves, so the owners of
    // the offer's mids must be known first.
    recordMids(midToPeer, mids);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    if (closed) return;
    const answer = pc.localDescription?.sdp;
    if (!answer) throw new Error('receive connection has no local answer');
    await request(ws, 'conference.media.renegotiate', { sdp: answer });
  }

  return {
    subscribe() {
      if (closed) return;
      chain = chain
        .then(() => (closed ? undefined : runSubscribe()))
        .catch((err: unknown) => {
          // A refused subscribe is skipped like a refused consume was; the next
          // `conference.media.published` asks again.
          if (err instanceof ConferenceRequestError) {
            console.warn('[conference] subscribe refused', err.code);
            return;
          }
          console.warn('[conference] subscribe failed', err);
        });
    },
    dropPeer(socketId) {
      dropPeer(midToPeer, socketId);
    },
    close() {
      if (closed) return;
      closed = true;
      midToPeer.clear();
      attachedTracks.clear();
      pc.close();
    },
  };
}

/**
 * Android runtime permission request. iOS resolves camera/mic through Info.plist
 * usage strings and the implicit prompt getUserMedia triggers.
 */
export async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
}
