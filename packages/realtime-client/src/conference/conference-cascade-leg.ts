import {
  DEFAULT_VOICE_GENDER,
  defaultTargetFor,
  roomTargets,
  type ConferenceTranslationBroadcast,
  type LanguageCode,
  type SessionOptions,
} from '@chatofy/types';
import type { CaptureDeps } from '../audio/pushed-pcm-capture.js';
import { pcm16ToBase64 } from '../audio/pcm-resampler.js';
import { RelayPlaybackSink } from '../audio/relay-playback-sink.js';
import {
  CASCADE_RUNTIME_OPTIONS,
  CASCADE_STREAM_COMMITTED,
} from '../conversation/cascade-runtime-options.js';
import {
  ConversationSession,
  type ConversationRuntimeOptions,
} from '../conversation/conversation-session.js';
import type { TranslateSocket, TranslateSocketHandlers } from '../transport/translate-socket.js';
import { CascadeSubtitleRelay } from './cascade-subtitle-relay.js';
import { LegRestartPolicy, type ConferenceLegEndReason } from './conference-leg-restart-policy.js';
import { LegSequenceCounter } from './leg-sequence-counter.js';
import { LegTurnPrimaries } from './leg-turn-primaries.js';

export type { ConferenceLegEndReason } from './conference-leg-restart-policy.js';

/**
 * A meeting speaker's translation: the /translate cascade, relayed into the room.
 *
 * Runs the same `ConversationSession` the /translate page runs, over the same
 * `/ws/translate`. What differs is only where the output goes: subtitles and
 * translated audio leave as `conference.translation.broadcast` envelopes, and
 * nothing plays on this machine. Platform-neutral — web and mobile differ only
 * in the capture deps and the sockets they hand in.
 */

/** How long a leave waits for in-flight turns to finish before cutting them. */
const LEAVE_DRAIN_MS = 3_000;

/**
 * The shared cascade tuning, with one override.
 *
 * `ownsEchoMeasurement: true` because this leg's playback is RELAYED: the sink's
 * `isPlaying` means "sent to the others and not yet played out there", not
 * "sounding here". Fed to the capture pump as `sounding`, every speaker who keeps
 * talking while their last sentence is relayed would be filed as echo in the
 * metrics `reportMetrics` sends.
 */
export const CONFERENCE_LEG_RUNTIME_OPTIONS: Readonly<ConversationRuntimeOptions> = Object.freeze({
  ...CASCADE_RUNTIME_OPTIONS,
  ownsEchoMeasurement: true,
});

export type ConferenceLegVoice = Partial<Pick<SessionOptions, 'voiceGender' | 'speed' | 'voices'>>;

export interface ConferenceCascadeLegOptions {
  audioDeps: CaptureDeps;
  /** Builds the translate socket for one session, with the token read for it. */
  createSocket: (handlers: TranslateSocketHandlers, token: string) => TranslateSocket;
  /** Awaited on every (re)build; `undefined` ends translation. */
  getToken: () => Promise<string | undefined>;
  sendBroadcast: (envelope: ConferenceTranslationBroadcast) => void;
  sourceLanguage: LanguageCode;
  /** The languages the other participants speak. */
  roomLanguages: Iterable<LanguageCode>;
  voice?: ConferenceLegVoice;
  /** True while a turn of this speaker has a line on listeners' screens. */
  onTranslatingChange?: (translating: boolean) => void;
  /**
   * Translation ended for good: no further session will be built, and the
   * speaker is no longer translated for the rest of this leg. Called at most
   * once, and never for a `leave()` or `stop()` the caller asked for.
   */
  onEnded?: (reason: ConferenceLegEndReason) => void;
  onLog?: (message: string) => void;
  /**
   * Whether a peer's translation is sounding on this device right now. For a
   * device whose leg microphone hears the room's playback (a phone on its
   * loudspeaker): while true, that playback cannot open a turn. An open turn is
   * never cut by it. Absent, the leg behaves as before.
   */
  receivedSounding?: () => boolean;
}

export interface ConferenceCascadeLeg {
  start(): Promise<void>;
  /** Let in-flight turns finish (bounded), then stop. Close the room socket after it resolves. */
  leave(): Promise<void>;
  /** Hard stop: no final is relayed for an open turn. Idempotent. */
  stop(): void;
  pause(): void;
  resume(): void;
  readonly muted: boolean;
  setRoomLanguages(languages: Iterable<LanguageCode>): void;
  /** The room socket refused a broadcast (`{ error }`); counted in the log. */
  noteRelayError(code: string): void;
}

export function createConferenceCascadeLeg(
  options: ConferenceCascadeLegOptions,
): ConferenceCascadeLeg {
  return new CascadeLeg(options);
}

class CascadeLeg implements ConferenceCascadeLeg {
  private room: LanguageCode[];
  private session: ConversationSession | null = null;
  private isMuted = false;
  private started = false;
  /** No further session may be built: left, stopped, or translation ended. */
  private disposed = false;
  private halted = false;
  /** The one drain a `leave()` runs; a second call shares it. */
  private leaving: Promise<void> | null = null;
  private drained: (() => void) | null = null;
  private translating = false;
  private relayErrors = 0;
  private readonly counter = new LegSequenceCounter();
  private readonly primaries = new LegTurnPrimaries();
  private readonly restarts: LegRestartPolicy;
  private readonly relay: CascadeSubtitleRelay;
  /** The leg's runtime: the shared one, plus the onset gate when the caller has one. */
  private readonly runtime: Readonly<ConversationRuntimeOptions>;

  constructor(private readonly o: ConferenceCascadeLegOptions) {
    this.room = [...o.roomLanguages];
    this.runtime = o.receivedSounding
      ? Object.freeze({ ...CONFERENCE_LEG_RUNTIME_OPTIONS, receivedSounding: o.receivedSounding })
      : CONFERENCE_LEG_RUNTIME_OPTIONS;
    this.restarts = new LegRestartPolicy({
      restart: () => void this.attempt(),
      log: (message) => this.log(message),
    });
    this.relay = new CascadeSubtitleRelay({
      sourceLanguage: o.sourceLanguage,
      // The turn's own start, never the room as it is now; the live room is
      // only a fallback for a turn this leg never saw start.
      primary: (sessionId) => this.primaries.get(sessionId) ?? this.targets().primary,
      emit: (subtitle) => o.sendBroadcast({ subtitle }),
      onOpenTurnCountChange: (count) => {
        if (count > 0 === this.translating) return;
        this.translating = count > 0;
        o.onTranslatingChange?.(this.translating);
      },
    });
  }

  get muted(): boolean {
    return this.isMuted;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.attempt();
  }

  leave(): Promise<void> {
    this.leaving ??= this.drainThenStop();
    return this.leaving;
  }

  private async drainThenStop(): Promise<void> {
    if (this.halted) return;
    this.disposed = true;
    this.restarts.cancel();
    const session = this.session;
    if (session?.isRunning) {
      // `finish` keeps the socket open until in-flight turns have been spoken,
      // so their real finals reach the room before the caller closes it.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LEAVE_DRAIN_MS);
        this.drained = () => {
          clearTimeout(timer);
          resolve();
        };
        session.finish();
      });
    }
    this.stop();
  }

  stop(): void {
    if (this.halted) return;
    this.halted = true;
    this.disposed = true;
    this.restarts.cancel();
    this.relay.closeOpen();
    const session = this.session;
    this.session = null;
    session?.stop();
    // A `leave()` waiting on its drain: the session it waits for is gone, and
    // the stop just above will never report back to it.
    const drained = this.drained;
    this.drained = null;
    drained?.();
  }

  pause(): void {
    this.setMuted(true);
  }

  resume(): void {
    this.setMuted(false);
  }

  setRoomLanguages(languages: Iterable<LanguageCode>): void {
    this.room = [...languages];
    this.session?.reconfigure(this.sessionOptions());
  }

  noteRelayError(code: string): void {
    this.relayErrors += 1;
    this.log(`room refused a translation broadcast (${code}); ${this.relayErrors} refused so far`);
  }

  /** Mute is the leg's, re-applied to every session it builds. */
  private setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.o.audioDeps.setPaused?.(muted);
    if (muted) this.session?.pause();
    else this.session?.resume();
  }

  /** Every other language in the room; the first is primary, the rest ride along. */
  private targets(): { primary: LanguageCode; extras: LanguageCode[]; voiced: boolean } {
    const source = this.o.sourceLanguage;
    const targets = roomTargets(source, this.room);
    return {
      primary: targets[0] ?? defaultTargetFor(source),
      extras: targets.slice(1),
      // Nobody else in the room yet: text still flows, speech would go nowhere.
      voiced: targets.length > 0,
    };
  }

  private sessionOptions(): SessionOptions {
    const { primary, extras, voiced } = this.targets();
    const voice = this.o.voice ?? {};
    // Never `splitSpeakers`/`embedSpeaker`: a split final's id is
    // `${sessionId}#i`, which the room's `turnId: z.uuid()` refuses.
    return {
      languagePair: { source: this.o.sourceLanguage, target: primary },
      ...(extras.length > 0 ? { alsoTranslateInto: extras } : {}),
      // Admitted under the meeting ceiling, which keeps turns free for /translate.
      meeting: true,
      voiceOutput: voiced,
      streamCommitted: CASCADE_STREAM_COMMITTED,
      voiceGender: voice.voiceGender ?? DEFAULT_VOICE_GENDER,
      ...(voice.speed === undefined ? {} : { speed: voice.speed }),
      ...(voice.voices === undefined ? {} : { voices: voice.voices }),
    };
  }

  private async attempt(): Promise<void> {
    this.restarts.attempting();
    let token: string | undefined;
    try {
      token = await this.o.getToken();
    } catch (err) {
      this.log(`could not read an access token: ${String(err)}`);
      if (!this.disposed) this.endIf(this.restarts.schedule());
      return;
    }
    if (this.disposed) return;
    if (token === undefined) {
      this.log('no access token; meeting translation ended');
      this.end('no_token');
      return;
    }

    const session = this.build(token);
    this.session = session;
    await session.start(this.sessionOptions());
    // Stopped, left, or failed (and already rescheduled) while starting.
    if (this.session !== session || !session.isRunning) return;
    this.restarts.live();
    // A peer that joined, or a mute pressed, during the start is applied now.
    session.reconfigure(this.sessionOptions());
    if (this.isMuted) session.pause();
  }

  private build(token: string): ConversationSession {
    const {
      openMicrophone,
      createAudioContext,
      createWorkletNode,
      workletUrl,
      ownsAudioResources,
    } = this.o.audioDeps;
    const cause = { closeCode: null as number | null, beforeSocket: true };
    const session: ConversationSession = new ConversationSession(
      {
        openMicrophone,
        createAudioContext,
        createWorkletNode,
        workletUrl,
        ownsAudioResources,
        createSocket: (handlers) => {
          // The session opens its socket only once the microphone and audio
          // graph are up, so a failure before this line is not the network's.
          cause.beforeSocket = false;
          return this.observeTurnStarts(
            this.o.createSocket(
              {
                ...handlers,
                onClosed: (code, reason) => {
                  cause.closeCode = code;
                  handlers.onClosed?.(code, reason);
                },
              },
              token,
            ),
          );
        },
        // No `sendDrop`/`sendSilence`: the room has no marker for either, so a
        // listener may play frames of a dropped turn already relayed — its
        // resequencer bounds that — and nothing plays here to silence.
        createPlaybackSink: (_context, onTurnDrained) =>
          new RelayPlaybackSink({
            sendAudio: (turnKey, samples, sampleRate, lang) =>
              this.relayAudio(turnKey, samples, sampleRate, lang),
            onTurnDrained,
          }),
      },
      {
        onStatus: () => {},
        onLevel: () => {},
        onMuted: () => {},
        onError: (message) => {
          if (message !== null) this.log(`translator: ${message}`);
        },
        onEchoHeard: () => {},
        onServerEvent: (event) => {
          if (this.session !== session) return;
          if (event.type === 'server.session.ready' && event.turnId !== undefined) {
            this.primaries.named(event.turnId, event.sessionId);
          }
          this.relay.handle(event);
        },
        onReset: () => {},
        onStopped: () => this.onStopped(session, cause),
        onLog: (message) => this.log(message),
      },
      () => this.runtime,
    );
    return session;
  }

  /**
   * Remember the target every turn is started with, as the server will run it.
   *
   * Wrapped here, at the one call that carries both the client's turn id and
   * the options the server receives, because nothing upstream reports a start.
   */
  private observeTurnStarts(socket: TranslateSocket): TranslateSocket {
    const startSession = socket.startSession.bind(socket);
    socket.startSession = (options, turnId) => {
      this.primaries.started(turnId, options.languagePair.target);
      startSession(options, turnId);
    };
    return socket;
  }

  private relayAudio(
    turnKey: string,
    samples: Int16Array,
    sampleRate: number,
    lang?: LanguageCode,
  ): void {
    // An untagged frame is in the target the turn STARTED with: the server tags
    // every frame of a turn that asked for several languages, so only a
    // one-language turn arrives without one.
    const tagged = lang ?? this.primaries.get(turnKey);
    if (tagged === undefined) {
      // Guessing from the room now could play one language to another's listeners.
      if (this.primaries.firstDrop(turnKey)) {
        this.log(`dropped untagged audio of turn ${turnKey}: its language is unknown`);
      }
      return;
    }
    this.o.sendBroadcast({
      audio: {
        lang: tagged,
        sequence: this.counter.next(tagged),
        sampleRate,
        payload: pcm16ToBase64(samples),
      },
    });
  }

  private onStopped(
    session: ConversationSession,
    cause: { closeCode: number | null; beforeSocket: boolean },
  ): void {
    if (this.session !== session) return;
    if (this.disposed) {
      this.drained?.();
      return;
    }
    // A stop nobody asked for: the socket dropped or the start failed.
    this.session = null;
    this.relay.closeOpen();
    this.endIf(this.restarts.stopped(cause));
  }

  private endIf(reason: ConferenceLegEndReason | null): void {
    if (reason !== null) this.end(reason);
  }

  /** Translation is over for good; the caller hears it once. */
  private end(reason: ConferenceLegEndReason): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restarts.cancel();
    this.o.onEnded?.(reason);
  }

  private log(message: string): void {
    this.o.onLog?.(`[conference-leg] ${message}`);
  }
}
