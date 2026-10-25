/**
 * One socket's worth of a conference call: the join, the media, the room events.
 *
 * A reconnect is a NEW attempt on a new socket, so everything an attempt holds —
 * transports, consumers, the translate leg, the local tracks, the audio sink —
 * is released by `dispose()` before the next one starts. Nothing leaks from one
 * attempt into the next, and nothing keeps capturing after the call is over.
 */
import * as mediasoupClient from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { z } from 'zod';
import type { LanguageCode } from '@chatofy/types';
import { TranslationAudioSink } from '@/hooks/use-translation-audio-sink';
import { acquireLocalMedia } from './acquire-local-media';
import { conferenceDebug } from './conference-debug-log';
import { parseRoomEvent, type RoomEvent } from './conference-room-events';
import {
  asTransportOptions,
  consumeTrack,
  parseSignal,
  request,
  send,
  wireRecvTransport,
  wireSendTransport,
} from './conference-signaling';
import { wireTranslate, type TranslateHandle } from './conference-translate-wiring';
import type { ConferenceSink, PeerMap } from './conference-types';
import { PeerSubtitleTracker } from './peer-subtitle-tracker';

const joinReplySchema = z.object({
  socketId: z.string().min(1),
  rtpCapabilities: z.looseObject({}),
  peers: z.array(
    z.object({
      socketId: z.string().min(1),
      displayName: z.string(),
      producers: z.array(z.object({ producerId: z.string().min(1), kind: z.string() })),
    }),
  ),
});

/** The attempt was disposed while its join was still running. */
export class AttemptDisposedError extends Error {
  constructor() {
    super('call attempt disposed');
    this.name = 'AttemptDisposedError';
  }
}

export interface CallAttemptOptions {
  /** An OPEN `/ws/conference` socket. The attempt never closes it. */
  ws: WebSocket;
  roomId: string;
  displayName: string;
  sourceLanguage: LanguageCode;
  token: string;
  translateUrl: string;
  /** Applied to the new local tracks, so a reconnect keeps the user muted. */
  muted: boolean;
  videoEnabled: boolean;
  sink: ConferenceSink;
  /** The owner ended the meeting. */
  onEnded: () => void;
}

interface ProducerRef {
  producerId: string;
  socketId: string;
}

export class CallAttempt {
  private disposed = false;
  private device: types.Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private translate: TranslateHandle | null = null;
  private stream: MediaStream | null = null;
  private readonly audio = new TranslationAudioSink();
  private readonly subtitles: PeerSubtitleTracker;
  private readonly peerNames = new Map<string, string>();
  private readonly departed = new Set<string>();
  private readonly consumers = new Map<string, (() => void)[]>();
  private readonly seenProducers = new Set<string>();
  /** Producers announced before the receive transport exists; null once it does. */
  private pendingProducers: ProducerRef[] | null = [];
  /** Consumes run one at a time: replies are matched by event name. */
  private consumeChain: Promise<void> = Promise.resolve();
  private readonly onMessage = (evt: MessageEvent) => {
    const signal = parseSignal(evt.data);
    const event = signal && parseRoomEvent(signal);
    if (event) this.handleRoomEvent(event);
  };

  constructor(private readonly options: CallAttemptOptions) {
    this.subtitles = new PeerSubtitleTracker((socketId, text) =>
      options.sink.peers((prev) => {
        const entry = prev.get(socketId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(socketId, { ...entry, subtitle: text });
        return next;
      }),
    );
  }

  /**
   * Join the room and bring media up. Resolves once in the call.
   *
   * Rejects with `ConferenceRequestError` when the gateway refuses a step,
   * `MediaPermissionError` when the microphone cannot be opened, and
   * `AttemptDisposedError` when the attempt was disposed part-way.
   */
  async run(): Promise<{ audioOnly: boolean }> {
    const { ws, sink } = this.options;
    const reply = joinReplySchema.parse(
      await request(ws, 'conference.join', {
        roomId: this.options.roomId,
        displayName: this.options.displayName,
        sourceLanguage: this.options.sourceLanguage,
      }),
    );
    this.assertLive();

    // From here the server already counts this peer in the room and will send
    // it room events — a producer, a peer joining — while media is still being
    // set up below. Listening now means none of them is lost; producers wait
    // in `pendingProducers` until there is a transport to consume them on.
    ws.addEventListener('message', this.onMessage);
    sink.selfSocketId(reply.socketId);
    for (const peer of reply.peers) this.peerNames.set(peer.socketId, peer.displayName);

    const device = new mediasoupClient.Device();
    await device.load({
      routerRtpCapabilities: reply.rtpCapabilities,
    });
    this.assertLive();
    this.device = device;

    const { stream, audioOnly } = await acquireLocalMedia();
    if (this.disposed) {
      stream.getTracks().forEach((track) => track.stop());
      throw new AttemptDisposedError();
    }
    this.stream = stream;
    stream.getAudioTracks().forEach((track) => (track.enabled = !this.options.muted));
    stream.getVideoTracks().forEach((track) => (track.enabled = this.options.videoEnabled));
    sink.localStream(stream);

    const sendTransport = device.createSendTransport(
      asTransportOptions(await request(ws, 'conference.transport.create', { direction: 'send' })),
    );
    this.sendTransport = sendTransport;
    this.assertLive();
    wireSendTransport(ws, sendTransport);
    for (const track of stream.getTracks()) {
      await sendTransport.produce({ track });
      this.assertLive();
    }
    if (this.options.muted) send(ws, 'conference.participant.mute', { muted: true });
    if (!this.options.videoEnabled) {
      send(ws, 'conference.participant.video', { videoEnabled: false });
    }

    const recvTransport = device.createRecvTransport(
      asTransportOptions(await request(ws, 'conference.transport.create', { direction: 'recv' })),
    );
    this.recvTransport = recvTransport;
    this.assertLive();
    wireRecvTransport(ws, recvTransport);

    this.translate = wireTranslate({
      translateUrl: this.options.translateUrl,
      conferenceSocket: ws,
      stream,
      sourceLanguage: this.options.sourceLanguage,
      token: this.options.token,
      onTranslating: (active) => sink.translating(active),
    });

    // The producers the join reply listed, then any announced since.
    const queued = this.pendingProducers ?? [];
    this.pendingProducers = null;
    for (const peer of reply.peers) {
      for (const producer of peer.producers) {
        this.enqueueConsume({ producerId: producer.producerId, socketId: peer.socketId });
      }
    }
    for (const producer of queued) this.enqueueConsume(producer);
    await this.consumeChain;
    this.assertLive();

    void this.audio.resumeAll().catch(() => undefined);
    sink.audioBlocked(this.audio.isAnySuspended());
    return { audioOnly };
  }

  setMuted(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
    send(this.options.ws, 'conference.participant.mute', { muted });
  }

  setVideoEnabled(videoEnabled: boolean): void {
    this.stream?.getVideoTracks().forEach((track) => (track.enabled = videoEnabled));
    send(this.options.ws, 'conference.participant.video', { videoEnabled });
  }

  sendChat(text: string): void {
    send(this.options.ws, 'conference.chat', { text });
  }

  async resumeAudio(): Promise<void> {
    await this.audio.resumeAll();
    this.options.sink.audioBlocked(this.audio.isAnySuspended());
  }

  /** Release everything this attempt holds. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.ws.removeEventListener('message', this.onMessage);
    // First, while the conference socket may still be open: stopping the
    // translate leg sends the open turn's final frame through it.
    this.translate?.stop();
    this.translate = null;
    this.subtitles.dispose();
    this.audio.close();
    for (const closers of this.consumers.values()) closers.forEach((close) => close());
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private assertLive(): void {
    if (this.disposed) throw new AttemptDisposedError();
  }

  private handleRoomEvent(event: RoomEvent): void {
    const { sink } = this.options;
    switch (event.type) {
      case 'new-producer':
        this.enqueueConsume({ producerId: event.producerId, socketId: event.socketId });
        return;
      case 'peer-joined':
        this.peerNames.set(event.socketId, event.displayName);
        return;
      case 'peer-left':
        this.forgetPeer(event.socketId);
        return;
      case 'participant-state':
        sink.peers((prev) => {
          const entry = prev.get(event.socketId);
          if (!entry) return prev;
          const next = new Map(prev);
          next.set(event.socketId, {
            ...entry,
            muted: event.muted ?? entry.muted,
            videoEnabled: event.videoEnabled ?? entry.videoEnabled,
          });
          return next;
        });
        return;
      case 'subtitle':
        this.subtitles.receive(event.subtitle, this.options.sourceLanguage);
        return;
      case 'audio':
        // The gateway already routes by language; this keeps a stray frame in
        // the wrong language from ever reaching the speakers.
        if (event.audio.lang !== this.options.sourceLanguage) return;
        this.audio.push(
          event.audio.speakerSocketId,
          event.audio.sequence,
          event.audio.sampleRate,
          event.audio.payload,
        );
        sink.audioBlocked(this.audio.isAnySuspended());
        return;
      case 'chat':
        sink.chat(event.message);
        return;
      case 'chat-refused':
        sink.chatRefused(event.refusal);
        return;
      case 'ended':
        this.options.onEnded();
        return;
    }
  }

  private forgetPeer(socketId: string): void {
    this.peerNames.delete(socketId);
    this.departed.add(socketId);
    this.pendingProducers = this.pendingProducers?.filter((p) => p.socketId !== socketId) ?? null;
    this.consumers.get(socketId)?.forEach((close) => close());
    this.consumers.delete(socketId);
    this.audio.forget(socketId);
    this.subtitles.forget(socketId);
    this.options.sink.peers((prev) => {
      if (!prev.has(socketId)) return prev;
      const next = new Map(prev);
      next.delete(socketId);
      return next;
    });
  }

  private enqueueConsume(producer: ProducerRef): void {
    if (this.pendingProducers !== null) {
      this.pendingProducers.push(producer);
      return;
    }
    // The join reply and a `new.producer` can name the same producer when it
    // was created while the join was being answered.
    if (this.seenProducers.has(producer.producerId)) return;
    this.seenProducers.add(producer.producerId);
    this.consumeChain = this.consumeChain
      .then(() => this.consumeOne(producer))
      .catch((err: unknown) => {
        conferenceDebug(`consume ${producer.producerId} failed: ${String(err)}`);
      });
  }

  private async consumeOne({ producerId, socketId }: ProducerRef): Promise<void> {
    const { device, recvTransport } = this;
    if (this.disposed || !device || !recvTransport || this.departed.has(socketId)) return;
    const { track, close } = await consumeTrack(this.options.ws, device, recvTransport, producerId);
    if (this.disposed || this.departed.has(socketId)) {
      close();
      return;
    }
    this.consumers.set(socketId, [...(this.consumers.get(socketId) ?? []), close]);
    const displayName = this.peerNames.get(socketId) ?? socketId;
    this.options.sink.peers((prev) => addTrack(prev, socketId, displayName, track));
  }
}

/** Upsert one remote track into the peer map. */
function addTrack(
  prev: PeerMap,
  socketId: string,
  displayName: string,
  track: MediaStreamTrack,
): PeerMap {
  const next = new Map(prev);
  const entry = next.get(socketId);
  if (entry) {
    // A fresh MediaStream, so a <video> bound to the old one re-renders with
    // both tracks rather than keeping the object it already had.
    next.set(socketId, { ...entry, stream: new MediaStream([...entry.stream.getTracks(), track]) });
  } else {
    next.set(socketId, {
      stream: new MediaStream([track]),
      displayName,
      subtitle: undefined,
      muted: false,
      videoEnabled: true,
    });
  }
  return next;
}
