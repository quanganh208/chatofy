/**
 * One socket's worth of a conference call: the join, the media, the room events.
 *
 * A reconnect is a NEW attempt on a new socket, so everything an attempt holds —
 * peer connections, remote tracks, the translate leg, the local tracks, the audio sink —
 * is released by `dispose()` before the next one starts. Nothing leaks from one
 * attempt into the next, and nothing keeps capturing after the call is over.
 */
import { z } from 'zod';
import type { LanguageCode } from '@chatofy/types';
import { ConferenceIceServerSchema } from '@chatofy/types/events';
import { TranslationAudioSink } from '@/hooks/use-translation-audio-sink';
import { acquireLocalMedia } from './acquire-local-media';
import { conferenceDebug } from './conference-debug-log';
import { createWebConferenceLeg, type WebConferenceLeg } from './conference-cascade-leg-web';
import { parseRoomEvent, peerLanguageSchema, type RoomEvent } from './conference-room-events';
import { ConferenceSfuMedia } from './conference-sfu-media';
import { parseSignal, request, send } from './conference-signaling';
import type { ConferenceSink, PeerMap } from './conference-types';
import { PeerSubtitleTracker } from './peer-subtitle-tracker';

const joinReplySchema = z.object({
  socketId: z.string().min(1),
  iceServers: z.array(ConferenceIceServerSchema),
  peers: z.array(
    z.object({
      socketId: z.string().min(1),
      displayName: z.string(),
      sourceLanguage: peerLanguageSchema,
      published: z.boolean(),
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
  /** Resolves the CURRENT access token; the translate leg reads it per session it builds. */
  getToken: () => Promise<string | undefined>;
  /** Full `ws(s)://…/ws/translate` endpoint for the speaker's translate leg. */
  translateSocketUrl: string;
  /** Applied to the new local tracks, so a reconnect keeps the user muted. */
  muted: boolean;
  videoEnabled: boolean;
  sink: ConferenceSink;
  /** The owner ended the meeting. */
  onEnded: () => void;
}

export class CallAttempt {
  private disposed = false;
  /** Starts as the option; a toggle during the join lands on the tracks acquired after it. */
  private muted: boolean;
  private media: ConferenceSfuMedia | null = null;
  private leg: WebConferenceLeg | null = null;
  private stream: MediaStream | null = null;
  private readonly audio = new TranslationAudioSink();
  private readonly subtitles: PeerSubtitleTracker;
  private readonly peerNames = new Map<string, string>();
  /** socketId → the language that peer speaks, for peers that said. Feeds the leg's targets. */
  private readonly peerLanguages = new Map<string, LanguageCode>();
  private readonly departed = new Set<string>();
  private readonly onMessage = (evt: MessageEvent) => {
    const signal = parseSignal(evt.data);
    const event = signal && parseRoomEvent(signal);
    if (event) this.handleRoomEvent(event);
  };

  constructor(private readonly options: CallAttemptOptions) {
    this.muted = options.muted;
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
    // it room events — a peer publishing, a peer joining — while media is still
    // being set up below. The receiving connection exists before the listener,
    // so a `media.published` that lands now is subscribed to, not lost.
    const media = new ConferenceSfuMedia({
      ws,
      iceServers: reply.iceServers,
      onTrack: (socketId, track) => this.addRemoteTrack(socketId, track),
    });
    this.media = media;
    ws.addEventListener('message', this.onMessage);
    sink.selfSocketId(reply.socketId);
    for (const peer of reply.peers) {
      this.peerNames.set(peer.socketId, peer.displayName);
      if (peer.sourceLanguage) this.peerLanguages.set(peer.socketId, peer.sourceLanguage);
    }
    if (reply.peers.some((peer) => peer.published)) media.subscribe();

    const { stream, audioOnly } = await acquireLocalMedia();
    if (this.disposed) {
      stream.getTracks().forEach((track) => track.stop());
      throw new AttemptDisposedError();
    }
    this.stream = stream;
    stream.getAudioTracks().forEach((track) => (track.enabled = !this.muted));
    stream.getVideoTracks().forEach((track) => (track.enabled = this.options.videoEnabled));
    sink.localStream(stream);

    await media.publish(stream);
    this.assertLive();
    if (this.muted) send(ws, 'conference.participant.mute', { muted: true });
    if (!this.options.videoEnabled) {
      send(ws, 'conference.participant.video', { videoEnabled: false });
    }

    this.startLeg(stream);

    await media.settled();
    this.assertLive();

    void this.audio.resumeAll().catch(() => undefined);
    sink.audioBlocked(this.audio.isAnySuspended());
    return { audioOnly };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // The leg mutes the published track with its own; before it exists there
    // is only the published track.
    if (this.leg) this.leg.setMuted(muted);
    else this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
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

  /**
   * Release everything this attempt holds. Idempotent.
   *
   * With `closeSocket` — the user left, and the conference socket is still
   * open — the translate leg first lets its in-flight turns finish (bounded),
   * so their real finals reach the room; only then is `closeSocket` called.
   * Without it — the socket is gone, or the teardown is forced — the leg stops
   * at once and relays no final.
   *
   * The camera and microphone stop at once either way: the leg drains from its
   * own clone of the microphone track, so a left user is never still captured.
   * Everything that only RECEIVES is released immediately too.
   */
  dispose(closeSocket?: () => void): void {
    if (this.disposed) {
      closeSocket?.();
      return;
    }
    this.disposed = true;
    this.options.ws.removeEventListener('message', this.onMessage);
    this.subtitles.dispose();
    this.audio.close();
    this.media?.close();
    this.media = null;

    const leg = this.leg;
    this.leg = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (leg && closeSocket) {
      void leg.leave().finally(closeSocket);
      return;
    }
    leg?.stop();
    closeSocket?.();
  }

  /**
   * Start the speaker's translate leg. Never fails the call: a meeting without
   * translation is still a meeting, so a leg that cannot start is logged.
   */
  private startLeg(stream: MediaStream): void {
    const { options } = this;
    try {
      const leg = createWebConferenceLeg({
        ws: options.ws,
        stream,
        sourceLanguage: options.sourceLanguage,
        roomLanguages: this.peerLanguages.values(),
        translateSocketUrl: options.translateSocketUrl,
        getToken: options.getToken,
        muted: this.muted,
        onTranslatingChange: (active) => {
          if (!this.disposed) options.sink.translating(active);
        },
        onEnded: (reason) => {
          conferenceDebug(`translation ended: ${reason}`);
          if (!this.disposed) options.sink.translationEnded(true);
        },
        onLog: conferenceDebug,
      });
      this.leg = leg;
      leg.start().catch((err: unknown) => conferenceDebug(`translate leg failed: ${String(err)}`));
    } catch (err) {
      conferenceDebug(`translate leg failed: ${String(err)}`);
    }
  }

  /** The room's languages changed: the leg retargets its next turn. */
  private roomLanguagesChanged(): void {
    this.leg?.setRoomLanguages(this.peerLanguages.values());
  }

  private assertLive(): void {
    if (this.disposed) throw new AttemptDisposedError();
  }

  private handleRoomEvent(event: RoomEvent): void {
    const { sink } = this.options;
    switch (event.type) {
      case 'media-published':
        this.media?.subscribe();
        return;
      case 'peer-joined':
        this.peerNames.set(event.socketId, event.displayName);
        if (event.sourceLanguage) {
          this.peerLanguages.set(event.socketId, event.sourceLanguage);
          this.roomLanguagesChanged();
        }
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
      case 'broadcast-refused':
        this.leg?.noteRelayError(event.code);
        return;
      case 'ended':
        this.options.onEnded();
        return;
    }
  }

  private forgetPeer(socketId: string): void {
    this.peerNames.delete(socketId);
    if (this.peerLanguages.delete(socketId)) this.roomLanguagesChanged();
    this.departed.add(socketId);
    this.media?.forgetPeer(socketId);
    this.audio.forget(socketId);
    this.subtitles.forget(socketId);
    this.options.sink.peers((prev) => {
      if (!prev.has(socketId)) return prev;
      const next = new Map(prev);
      next.delete(socketId);
      return next;
    });
  }

  private addRemoteTrack(socketId: string, track: MediaStreamTrack): void {
    // A subscribe answered after the peer left can still deliver its tracks.
    if (this.disposed || this.departed.has(socketId)) return;
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
