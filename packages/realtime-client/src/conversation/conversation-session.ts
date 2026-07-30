import {
  DEFAULT_VOICE_GENDER,
  type ServerEvent,
  type SessionOptions,
  type TurnOutcome,
} from '@chatofy/types';
import type { TranslateSocket, TranslateSocketHandlers } from '../transport/translate-socket.js';
import { CapturePump } from '../audio/capture-pump.js';
import { OrderedPlayback } from '../audio/ordered-playback.js';
import { PcmPlaybackQueue } from '../audio/pcm-playback-queue.js';
import { base64ToPcm16, downsampleToPcm16, TARGET_SAMPLE_RATE } from '../audio/pcm-resampler.js';
import { DEFAULT_MAX_IN_FLIGHT, TurnPipeline } from './turn-pipeline.js';
import type { ConversationStatus } from './conversation-status.js';

/** Samples the worklet posts per block, at the audio context's own rate. */
const WORKLET_BLOCK_SAMPLES = 1024;

/** How often the level meter may update. ~10 Hz instead of ~47. */
const LEVEL_UPDATE_MS = 100;

/** Everything one run of the conversation owns and must give back. */
interface LiveResources {
  socket?: TranslateSocket;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  playback?: PcmPlaybackQueue;
  ordered?: OrderedPlayback;
  pipeline?: TurnPipeline;
  pump?: CapturePump;
}

export interface ConversationSessionDeps {
  openMicrophone: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  /** `AudioWorkletNode` is a global, so it has to arrive from outside to be faked. */
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  createSocket: (handlers: TranslateSocketHandlers) => TranslateSocket;
  workletUrl: string;
}

/**
 * Settings that change how a run behaves, read afresh at each {@link
 * ConversationSession.start}.
 *
 * Read rather than captured because a caller may flip them between runs — that is
 * what the echo measurement needs. The defaults are the single-turn,
 * half-duplex behaviour the web page has always had; nothing here has to be set
 * for that to keep working.
 */
export interface ConversationRuntimeOptions {
  /** Keep listening while our own translation plays. */
  fullDuplex?: boolean;
  /** End a turn straight back to listening rather than waiting to be re-armed. */
  continuous?: boolean;
  /** Cut a turn at this length. 0 or absent never cuts. */
  maxUtteranceMs?: number;
  /** Turns this client will have open at the server at once. */
  maxInFlight?: number;
  /**
   * Report per-turn timings to the server, which appends them to its JSONL sink.
   *
   * Off by default, and both halves of that matter. The numbers are only useful
   * while someone is collecting them, and this is the only data a client writes to
   * the server's disk — so it is opt-in on the client as well as gated by
   * `TURN_METRICS_PATH` on the server.
   */
  reportMetrics?: boolean;
}

export interface ConversationSessionListeners {
  onStatus: (status: ConversationStatus) => void;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
  onError: (message: string | null) => void;
  onEchoHeard: () => void;
  /** Straight to the reducer that owns the transcript. */
  onServerEvent: (event: ServerEvent) => void;
  /** Clear the transcript for a conversation that is starting over. */
  onReset: () => void;
  /**
   * A turn ended without the server ever saying so: refused at the ceiling,
   * dropped at a ceiling here, or released by the stall watchdog.
   *
   * Optional because the single-turn page cannot reach any of those paths. A
   * turn-keyed transcript needs it, or a live line left by such a turn stays on
   * screen for the rest of the conversation. `sessionId` is null when the turn
   * never got one.
   */
  onTurnAbandoned?: (sessionId: string | null, reason: string) => void;
  /** Diagnostics that must never be silent — dropped turns above all. */
  onLog?: (message: string) => void;
}

/**
 * One hands-free conversation over `/ws/translate`: microphone, socket,
 * playback and the state that ties them together.
 *
 * Turn boundaries are decided by {@link CapturePump}, which owns the whole policy
 * and is unit-tested. Turn IDENTITY and lifetime belong to {@link TurnPipeline},
 * and playback ORDER to {@link OrderedPlayback}. This class is the wiring between
 * them, the socket and the listeners; a decision about when to listen belongs in
 * the pump, and one about which turn an event concerns belongs in the pipeline.
 *
 * The four fields that used to sit here — `sessionId`, `sequence`, `pending`,
 * `turnEnded` — are all per turn rather than per conversation, and now live in the
 * pipeline. Keeping them here is what made the forced cut send turn N's tail under
 * turn N+1's id with a sequence restarting at zero.
 *
 * At `maxInFlight: 1` the old invariant still holds and still matters: the
 * microphone is re-armed only once the turn has BOTH ended server-side AND
 * finished playing. Releasing on either alone reopens it into our own loudspeaker,
 * and two people sharing one phone then get a loop where the app translates itself
 * forever. Continuous mode removes the need for that by removing the mute
 * entirely — the extension's capture and playback are structurally separate.
 */
export class ConversationSession {
  /**
   * Identifies the current `start()` run. `stop()` bumps it so a start still
   * awaiting the microphone abandons the one it is about to be handed instead
   * of publishing it to a session the caller believes is torn down.
   */
  private generation = 0;
  private live: LiveResources | null = null;
  /**
   * Settings for the conversation in progress. Held rather than passed per
   * turn: a conversation opens a fresh server session for every turn, and all
   * of them must be spoken by the same voice in the same direction.
   */
  private options: SessionOptions = {
    direction: 'vi_to_en',
    voiceGender: DEFAULT_VOICE_GENDER,
  };
  /**
   * Set when the server closes the turn; half of the re-arm condition.
   *
   * Only used on the single-turn path. With several turns in flight there is no
   * single "the turn" to be waiting on, and nothing to re-arm — the pump never
   * leaves `idle`.
   */
  private turnEnded = false;
  private lastLevelAt = 0;

  constructor(
    private readonly deps: ConversationSessionDeps,
    private readonly listeners: ConversationSessionListeners,
    private readonly runtimeOptions: () => ConversationRuntimeOptions = () => ({}),
  ) {}

  get isRunning(): boolean {
    return this.live !== null;
  }

  async start(options: SessionOptions): Promise<void> {
    // Catches a start issued while one is already running: without it the
    // transcript resets in front of the speaker and a second microphone opens
    // alongside the first, sending audio in parallel.
    //
    // A double tap during startup is a different case and a different mechanism:
    // both calls get past here, and the generation counter below decides which
    // one survives.
    if (this.isRunning) return;

    const generation = ++this.generation;
    const isStale = () => this.generation !== generation;

    this.listeners.onError(null);
    this.listeners.onReset();
    this.listeners.onStatus('connecting');
    this.options = options;

    const runtime = this.runtimeOptions();
    const maxInFlight = runtime.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    const singleTurn = maxInFlight <= 1;

    // Held locally until every await has cleared, so a teardown mid-startup
    // releases them instead of leaking a live microphone.
    const local: LiveResources = {};

    try {
      local.stream = await this.deps.openMicrophone();
      if (isStale()) return this.releaseResources(local);

      local.context = this.deps.createAudioContext();
      await local.context.audioWorklet.addModule(this.deps.workletUrl);
      if (isStale()) return this.releaseResources(local);

      local.socket = this.deps.createSocket({
        onEvent: (event) => this.handleServerEvent(event),
        onError: (message) => this.listeners.onError(message),
        onClosed: () => {
          // Without a socket the conversation cannot continue, and leaving it
          // "listening" would strand the microphone muted mid-turn.
          this.listeners.onError('Connection to the translator dropped');
          this.stop();
        },
      });
      await local.socket.connect();
      if (isStale()) return this.releaseResources(local);

      const socket = local.socket;
      const context = local.context;

      const playback = new PcmPlaybackQueue(context, (turnKey) =>
        this.live?.ordered?.onTurnDrained(turnKey),
      );
      local.playback = playback;

      const ordered = new OrderedPlayback(playback, {
        onDropped: (turnKey, reason) => this.abandonTurn(turnKey, reason),
        onPlayingChanged: (playing) => {
          if (!playing && singleTurn) this.armIfTurnComplete();
        },
        onLog: (message) => this.listeners.onLog?.(message),
      });
      local.ordered = ordered;

      const pipeline = new TurnPipeline(
        socket,
        {
          onTurnOpened: (turnId) => ordered.open(turnId),
          onTurnClosed: (turnId, reason) => {
            // Filed BEFORE the ordering layer retires the turn, and before the
            // pipeline forgets it — both hold half the row.
            if (runtime.reportMetrics) {
              this.reportTurnMetrics(socket, pipeline, ordered, turnId, reason);
            }
            // Every path ends here, so the ordering layer can never be left
            // waiting on a turn that will not arrive.
            ordered.finish(turnId);
            if (!isServerReason(reason)) this.abandonTurn(turnId, reason);
            if (singleTurn) {
              this.turnEnded = true;
              this.armIfTurnComplete();
            }
          },
          onLog: (message) => this.listeners.onLog?.(message),
        },
        maxInFlight,
      );
      pipeline.configure(options);
      local.pipeline = pipeline;

      const pump = new CapturePump(
        {
          onTurnOpen: (preRoll) => {
            this.listeners.onStatus('hearing-speech');
            pipeline.openTurn(preRoll);
          },
          onAudio: (block) => pipeline.pushAudio(block),
          // A suspected pause: let the server get a head start on the text.
          onProbableEnd: () => pipeline.speculate(),
          onTurnClose: (reason) => {
            // Only the single-turn path goes quiet here. In continuous mode the
            // microphone stays open, so announcing "translating" and muting would
            // be false — the speaker is still talking into the next turn.
            if (singleTurn) {
              this.listeners.onStatus('translating');
              this.listeners.onMuted(true);
            }
            // A cut turn ends mid-sentence, so its row has to say so rather than
            // leaving the quality drop looking like a pipeline fault.
            pipeline.closeCapturedTurn(reason === 'forced');
          },
          onLevel: (value) => {
            const now = Date.now();
            if (now - this.lastLevelAt < LEVEL_UPDATE_MS) return;
            this.lastLevelAt = now;
            this.listeners.onLevel(value);
          },
          onEchoHeard: () => {
            // Counted against the turn being captured as well as reported, so the
            // loudspeaker measurement can be read per turn rather than only as a
            // running total for the whole session.
            pipeline.noteEcho();
            this.listeners.onEchoHeard();
          },
        },
        Math.max(1, Math.floor(WORKLET_BLOCK_SAMPLES / (context.sampleRate / TARGET_SAMPLE_RATE))),
        {
          fullDuplex: runtime.fullDuplex ?? false,
          continuous: runtime.continuous ?? false,
          maxUtteranceMs: runtime.maxUtteranceMs,
        },
      );
      local.pump = pump;

      const node = this.deps.createWorkletNode(context);
      local.node = node;
      node.port.onmessage = (message: MessageEvent<Float32Array>) => {
        pump.push(downsampleToPcm16(message.data, context.sampleRate));
      };
      context.createMediaStreamSource(local.stream).connect(node);

      this.live = local;
      this.listeners.onStatus('listening');
    } catch (err) {
      this.releaseResources(local);

      // The last stale checkpoint, and the one the success path spells out at
      // every await: a run that has already been abandoned gives back what it
      // built and says nothing more. Both the state `stop()` clears and the
      // error banner belong to the run that replaced it, so a microphone
      // refused late — the prompt waits for a human, so late is normal — would
      // otherwise tear down a conversation that is working and blame it for a
      // permission it never asked for.
      if (isStale()) return;

      this.stop();
      this.listeners.onError(
        err instanceof Error ? err.message : 'Could not start the conversation',
      );
    }
  }

  /**
   * End the run: give back its resources AND clear the state a new run would
   * otherwise inherit.
   *
   * Deliberately does not clear the error. `onClosed` reports the dropped
   * connection and then calls this, and a user returned to idle with no
   * explanation has been told nothing at all.
   */
  stop(): void {
    this.generation += 1;
    const live = this.live;
    this.live = null;
    this.releaseResources(live ?? {});

    this.turnEnded = false;

    this.listeners.onStatus('idle');
    this.listeners.onLevel(0);
    this.listeners.onMuted(false);
  }

  /**
   * Give back exactly the resources handed in, and nothing else.
   *
   * Kept apart from {@link stop} because a start that has gone stale must let go
   * of what it built without touching shared state: the run that replaced it is
   * already using that state, and blanking its turn state there would leave the
   * microphone open, the meter moving, and not one byte reaching the server.
   */
  private releaseResources(r: Partial<LiveResources>): void {
    r.socket?.close();
    r.node?.disconnect();
    if (r.node) r.node.port.onmessage = null;
    r.ordered?.stop();
    r.playback?.stop();
    r.pipeline?.reset();
    r.stream?.getTracks().forEach((track) => track.stop());
    void r.context?.close().catch(() => {});
    r.pump?.reset();
  }

  /**
   * Listen again, but only when the turn is finished in both senses. Called
   * from the server's end-of-turn and from playback falling idle, because either
   * can be the last to happen.
   *
   * Single-turn only. With turns running concurrently the pump never leaves
   * `idle`, so there is nothing to re-arm and no moment at which "the" turn is
   * the one being waited for.
   */
  private armIfTurnComplete(): void {
    if (!this.turnEnded) return;
    if (this.live?.ordered?.isBusy) return;
    this.turnEnded = false;
    this.live?.pump?.armNextTurn();
    this.listeners.onMuted(false);
    this.listeners.onStatus('listening');
  }

  /** Report a turn that ended without the server closing it. */
  private abandonTurn(turnId: string, reason: string): void {
    const sessionId = this.live?.pipeline?.sessionIdFor(turnId) ?? null;
    this.listeners.onTurnAbandoned?.(sessionId, reason);
  }

  /**
   * File one turn's measurements, joining what capture saw to what playback did.
   *
   * Sent when the turn CLOSES, not when it finishes playing. A turn refused at the
   * ceiling, dropped at a backlog ceiling, or failed never plays at all — so
   * waiting for playback would silently omit exactly those turns, and the coverage
   * figure would then be measuring the success rate of playback rather than the
   * coverage of capture. It would look best at the moment the pipeline was worst.
   *
   * A turn with no server id is not reported: the server keys rows by its own id
   * and validates ownership against it, so there is nothing to attribute a row to.
   * Those turns never reached the server at all, which is itself visible in the log.
   */
  private reportTurnMetrics(
    socket: TranslateSocket,
    pipeline: TurnPipeline,
    ordered: OrderedPlayback,
    turnId: string,
    reason: string,
  ): void {
    const captured = pipeline.metricsFor(turnId);
    if (!captured?.sessionId) return;
    const play = ordered.metricsFor(turnId);

    socket.sendTurnMetrics({
      sessionId: captured.sessionId,
      speechStartedAt: captured.openedAt,
      speechEndedAt: captured.closedAt,
      capturedMs: captured.capturedMs,
      heldMs: captured.heldMs,
      firstAudioPlayedAt: play.firstAudioPlayedAt,
      lastAudioPlayedAt: play.lastAudioPlayedAt,
      queuedAheadMs: play.queuedAheadMs,
      cutForced: captured.cutForced,
      outcome: outcomeFor(reason, play.firstAudioPlayedAt !== undefined),
      echoEvents: captured.echoEvents,
    });
  }

  private handleServerEvent(event: ServerEvent): void {
    // Every event goes to the reducer; the switch below is transport and
    // playback, which the reducer deliberately knows nothing about.
    this.listeners.onServerEvent(event);

    const pipeline = this.live?.pipeline;
    const ordered = this.live?.ordered;

    switch (event.type) {
      case 'server.session.ready':
        pipeline?.onReady(event.turnId, event.sessionId);
        break;

      case 'server.audio.frame': {
        this.listeners.onStatus('playing');
        // Frames carry the server's id; speaking order is keyed by the client's,
        // because order is fixed when capture opens the turn and the server id
        // does not exist yet. The pipeline is the join.
        const turnKey = pipeline?.turnIdFor(event.frame.sessionId);
        if (!turnKey) break;
        ordered?.push(turnKey, base64ToPcm16(event.frame.payload), event.frame.sampleRate);
        break;
      }

      case 'server.session.ended':
        // The pipeline reports the close back through `onTurnClosed`, which is
        // where the ordering layer and the re-arm are driven from. Doing it here
        // as well would run both twice.
        pipeline?.onServerClosed(event.reason, {
          sessionId: event.sessionId,
          turnId: event.turnId,
        });
        break;

      case 'server.error':
        // A turn-scoped failure ends that turn; a connection-level one belongs to
        // no turn and only reaches the banner. `too_many_turns` is handled inside
        // the pipeline, which keeps the audio and retries.
        pipeline?.onError(event.code, {
          sessionId: event.sessionId,
          turnId: event.turnId,
        });
        this.listeners.onError(event.message);
        break;

      default:
        break;
    }
  }
}

/**
 * Whether a close reason came from the server.
 *
 * The reasons the pipeline invents for itself — a turn capture finished with
 * before it ever reached the server, one dropped at the pending ceiling, and a
 * teardown — produce no `server.session.ended`, so a turn-keyed transcript has to
 * be told about them separately or their live lines stay on screen.
 */
function isServerReason(reason: string): boolean {
  return reason !== 'never_started' && reason !== 'dropped_pending' && reason !== 'stopped';
}

/**
 * Map a close reason onto the outcome the metrics contract names.
 *
 * `played` requires that audio actually reached the loudspeaker, not merely that
 * the server said the turn completed: a turn dropped from the playback queue after
 * its transcript arrived completed server-side and was never heard.
 */
function outcomeFor(reason: string, wasHeard: boolean): TurnOutcome {
  if (reason === 'too_many_turns') return 'rejected';
  if (reason === 'dropped_pending' || reason === 'backlog' || reason === 'stalled') {
    return 'dropped';
  }
  if (reason === 'no_audio') return 'no_audio';
  if (reason === 'completed') return wasHeard ? 'played' : 'no_audio';
  return 'error';
}
