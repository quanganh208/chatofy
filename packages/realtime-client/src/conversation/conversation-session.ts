import {
  DEFAULT_VOICE_GENDER,
  type ServerEvent,
  type SessionOptions,
  type TurnOutcome,
} from '@chatofy/types';
import type { TranslateSocket, TranslateSocketHandlers } from '../transport/translate-socket.js';
import { CapturePump } from '../audio/capture-pump.js';
import { OrderedPlayback, type PlaybackSink } from '../audio/ordered-playback.js';
import { PcmPlaybackQueue } from '../audio/pcm-playback-queue.js';
import { base64ToPcm16, downsampleToPcm16, TARGET_SAMPLE_RATE } from '../audio/pcm-resampler.js';
import { DEFAULT_MAX_IN_FLIGHT, TurnPipeline } from './turn-pipeline.js';
import type { ConversationStatus } from './conversation-status.js';

/** Samples the worklet posts per block, at the audio context's own rate. */
const WORKLET_BLOCK_SAMPLES = 1024;

/** How often the level meter may update. ~10 Hz instead of ~47. */
const LEVEL_UPDATE_MS = 100;

/** Playback drops kept until the matching turn's metrics row is filed. */
const RETAINED_PLAYBACK_DROPS = 32;

/** Everything one run of the conversation owns and must give back. */
interface LiveResources {
  socket?: TranslateSocket;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  /** The edge feeding the worklet. Held so teardown can actually cut it. */
  source?: MediaStreamAudioSourceNode;
  playback?: PlaybackSink;
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
  /**
   * Where translated audio goes. Defaults to the loudspeakers of the machine
   * running this session.
   *
   * Exists because one caller's output device is not a loudspeaker at all. The
   * extension's outbound direction translates what the USER says and has to
   * deliver it to the OTHER participants, which means handing the samples to a
   * page it does not share an audio graph with — a `MediaStream` cannot cross
   * that boundary, so the leaf that touches an output device moves and
   * everything above it stays here. Ordering, backlog and the stall watchdog
   * are not the caller's business and must not be reimplemented per sink.
   *
   * `onTurnDrained` arrives as a parameter rather than being wired by the
   * caller because it closes over state this class only assigns at the end of
   * `start()`; a caller has no way to reconstruct that loop.
   *
   * A sink that ships samples somewhere else must tolerate `stop()` before it
   * has anywhere to ship them: teardown of a failed start runs through the same
   * path.
   */
  createPlaybackSink?: (
    context: AudioContext,
    onTurnDrained: (turnKey: string) => void,
  ) => PlaybackSink;
  workletUrl: string;
  /**
   * Whether this session may close the `AudioContext` and stop the stream it is given.
   *
   * True by default, which is right when it built them: the web page hands over a
   * fresh context and a fresh microphone per run and wants both released.
   *
   * The extension passes `false`, and not as a preference. It shares one context
   * between this session, the ducking gain node and the echo microphone, and the
   * stream it hands over is the captured tab — which is also what the meeting's own
   * audio is played back through. A session that closed those on teardown would, on
   * something as ordinary as the API restarting mid-call, silence the meeting
   * permanently: `tabCapture` has already muted the tab for the user, and the graph
   * that was replaying it is gone.
   */
  ownsAudioResources?: boolean;
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
  /**
   * Whether translated audio is sounding or waiting to sound.
   *
   * Taken from `OrderedPlayback.isBusy`, which counts turns still queued rather than
   * only samples currently playing. Anything that reacts to playback must use this
   * and not "is a sample playing": with a growing backlog the latter is permanently
   * true, so a consumer keyed on it — ducking, most obviously — would never let go.
   */
  onPlaybackBusy?: (busy: boolean) => void;
  /**
   * The run has ended, including when it ended itself.
   *
   * A dropped socket tears the session down from the inside, so a caller that holds
   * resources of its own has no other way to learn about it — and would otherwise sit
   * with a microphone open and a UI claiming to be running.
   */
  onStopped?: () => void;
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
    // Off until a caller asks for it. `SessionOptions` is the schema's OUTPUT
    // type, where every default is already resolved, so the field is required
    // here even though the wire format leaves it optional — an older client
    // omitting it still parses to exactly this value.
    streaming: false,
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
  /**
   * Turns the playback layer gave up on, and why.
   *
   * Playback drops and pipeline closes are different events arriving at different
   * times: a turn dropped at the backlog ceiling or released by the stall watchdog is
   * still open as far as the pipeline is concerned, and the server will close it
   * normally later. Without this the row for that turn would be filed as `played` —
   * it did produce some audio before being cut — which is exactly the flattery this
   * channel exists to avoid, since it makes the numbers best when playback is worst.
   *
   * Bounded, like every other retention map here.
   */
  private readonly playbackDrops = new Map<string, string>();

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

      const onTurnDrained = (turnKey: string) => this.live?.ordered?.onTurnDrained(turnKey);
      const playback =
        this.deps.createPlaybackSink?.(context, onTurnDrained) ??
        new PcmPlaybackQueue(context, onTurnDrained);
      local.playback = playback;

      const ordered = new OrderedPlayback(playback, {
        onDropped: (turnKey, reason) => {
          this.rememberPlaybackDrop(turnKey, reason);
          this.abandonTurn(turnKey, reason);
        },
        onPlayingChanged: (playing) => {
          this.listeners.onPlaybackBusy?.(playing);
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
      // Kept, not discarded. Disconnecting the worklet only severs its OUTPUTS;
      // this edge is what feeds it, and a worklet still runs — and still posts a
      // block every ~21ms — without any downstream connection. That was harmless
      // while every session closed its own context on teardown, and is not once
      // `ownsAudioResources: false` lets the context outlive the session.
      local.source = context.createMediaStreamSource(local.stream);
      local.source.connect(node);

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
    // Last, so a caller releasing its own resources here sees a session that is
    // already fully torn down.
    this.listeners.onStopped?.();
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
    r.source?.disconnect();
    r.node?.disconnect();
    if (r.node) r.node.port.onmessage = null;
    r.ordered?.stop();
    r.playback?.stop();
    r.pipeline?.reset();
    r.pump?.reset();

    // Everything above belongs to this session unconditionally. The context and the
    // stream may not — see `ownsAudioResources`.
    if (this.deps.ownsAudioResources === false) return;
    r.stream?.getTracks().forEach((track) => track.stop());
    void r.context?.close().catch(() => {});
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

  /**
   * Count one instance of our own playback being heard back, against the turn being
   * captured.
   *
   * Public because in continuous mode the pump's own echo gate is unreachable: it only
   * runs while capture is muted, and continuous mode never mutes. A caller that has
   * its own microphone for this — the extension does, because the tab it captures is
   * not where the echo appears — reports through here so the count lands on the same
   * per-turn field either way.
   */
  noteEchoHeard(): void {
    this.live?.pipeline?.noteEcho();
    this.listeners.onEchoHeard();
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
    // A playback drop outranks whatever the pipeline calls the close. The server may
    // have completed the turn perfectly; the listener still never heard it.
    const effectiveReason = this.playbackDrops.get(turnId) ?? reason;

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
      outcome: outcomeFor(effectiveReason, play.firstAudioPlayedAt !== undefined),
      echoEvents: captured.echoEvents,
    });
    this.playbackDrops.delete(turnId);
  }

  /** Retained bounded, because the row is filed later than the drop. */
  private rememberPlaybackDrop(turnKey: string, reason: string): void {
    this.playbackDrops.set(turnKey, reason);
    while (this.playbackDrops.size > RETAINED_PLAYBACK_DROPS) {
      const oldest = this.playbackDrops.keys().next().value;
      if (oldest === undefined) break;
      this.playbackDrops.delete(oldest);
    }
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
