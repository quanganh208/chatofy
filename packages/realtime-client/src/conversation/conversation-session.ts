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

/**
 * How long a graceful end waits for the tail before cutting it.
 *
 * Longer than the queue's own stall watchdog on purpose: that one releases a
 * head with no sign of life and lets the drain complete normally, so this only
 * fires when even that did not resolve things — a socket that dropped a message,
 * or a server that stopped answering. Without it the panel would sit on
 * `finishing` with no way out but a reload.
 *
 * Generous rather than tight, because the cost of being early is cutting off a
 * translation someone is waiting for, and the cost of being late is a few
 * seconds of a button that already said what it was doing.
 */
const DRAIN_TIMEOUT_MS = 20_000;

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
   * The caller counts echo itself, so the capture pump must not also count it.
   *
   * Set by a caller whose echo does not appear at the pump's microphone. The
   * extension is the case: its pump is fed the CAPTURED TAB — the other
   * participants — while the translation plays through an offscreen document, so
   * every remote speaker talking over that playback would be counted as echo and
   * filed into the same per-turn field its dedicated echo microphone writes.
   * Those events are not echo; `echo-monitor.ts` exists precisely because the
   * digital loop cannot exist there by construction.
   *
   * Suppresses the pump's `sounding` wiring entirely rather than only its
   * counter, which also keeps the pump from polling the playback sink on the
   * audio path. Safe only because such a caller is full duplex by the same
   * structural argument — with capture and playback separated there is nothing
   * for the mute to protect — and a caller that is not gets told below.
   */
  ownsEchoMeasurement?: boolean;
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
   * What capture measured about a turn that has just closed.
   *
   * The server cannot supply either field: `cutForced` is this tab's own length
   * ceiling firing, and the times are when the microphone opened and closed, not
   * when a translation came back. A transcript that groups a ceiling-cut
   * utterance back into one block needs both.
   *
   * Fires AFTER `server.transcript.final` for the same turn — the pipeline
   * reports a close once the SERVER has closed it — so a consumer must key this
   * separately and join at render time rather than expecting to attach it to a
   * segment on arrival.
   *
   * Optional, like `onTurnAbandoned`: the single-turn page has one turn and
   * nothing to group.
   */
  onTurnCaptured?: (capture: {
    sessionId: string;
    cutForced: boolean;
    openedAt: number;
    closedAt: number;
  }) => void;
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
  };
  /**
   * Set when the server closes the turn; half of the re-arm condition.
   *
   * Only used on the single-turn path. With several turns in flight there is no
   * single "the turn" to be waiting on, and nothing to re-arm — the pump never
   * leaves `idle`.
   */
  private turnEnded = false;
  /**
   * The microphone is off, but nothing has been released.
   *
   * Kept apart from `live` because a pause is not a teardown: every resource in
   * {@link LiveResources} stays exactly as it was, and the only thing that
   * changes is that captured blocks stop reaching the pump.
   */
  private paused = false;
  /**
   * The conversation is ending, and the tail has not finished playing.
   *
   * Distinct from `paused` because it is one-way: nothing leaves this state
   * except teardown, either when the queue empties or when the deadline below
   * fires.
   */
  private finishing = false;
  /** Backstop for a drain that never completes. Cleared by `stop`. */
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Capture is off, and the conversation is still open. */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Report a status, unless a pause outranks it.
   *
   * Every status this class raises goes through here EXCEPT the two that decide
   * whether a pause is on at all — `pause()` sets it, and `stop()` clears the
   * flag before reporting `idle`, so teardown always wins.
   *
   * The swallow is not cosmetic. `server.audio.frame` reports `playing` on every
   * frame of a translation still draining, and that drain is precisely what a
   * pause does NOT interrupt — so without this the label flips back to "Speaking"
   * a few milliseconds after the user pressed Pause, and, for a panel that draws
   * its buttons from the status, so does the button.
   *
   * Restoring `paused` after the drain instead was considered and does not work:
   * in continuous mode nothing reports the end of playback as a status at all —
   * `armIfTurnComplete` runs only on the single-turn path — so there is no edge
   * to restore on.
   */
  private emitStatus(next: ConversationStatus): void {
    if (this.paused || this.finishing) return;
    this.listeners.onStatus(next);
  }

  /** Capture is off, whichever of the two reasons put it there. */
  private get captureStopped(): boolean {
    return this.paused || this.finishing;
  }

  /**
   * Turn the microphone off without ending the conversation.
   *
   * Releases NOTHING: the socket stays open, the audio context stays running,
   * and every turn already in flight keeps arriving and playing out. What the
   * user just said is translated and spoken — a pause silences the input, not
   * the answer to the sentence they finished.
   *
   * The turn open at this moment is CLOSED rather than abandoned, and closed the
   * ordinary way, with `cutForced` false: that flag marks this tab's own length
   * ceiling cutting someone off mid-word, and it is read as the right-censoring
   * signal of the turn-length distribution. A pause is not a cut, and recording
   * it as one would bias a measurement.
   */
  pause(): void {
    // A conversation already ending cannot be paused: the tail is playing out on
    // its way to teardown, and there is nothing left to come back to.
    if (!this.live || this.paused || this.finishing) return;
    this.paused = true;

    this.live.pipeline?.closeCapturedTurn(false);
    // Clears the gate, the pre-roll and the held silence, so the first block
    // after resuming cannot carry audio from before the pause.
    this.live.pump?.armNextTurn();

    // The meter reports an edge rather than a level, so without this the needle
    // stays wherever the last block left it and the UI shows a live microphone.
    this.listeners.onLevel(0);
    // Direct, not through `emitStatus`: the flag is already set, and this is the
    // status that announces it.
    this.listeners.onStatus('paused');
  }

  /** Listen again in the same conversation, on the same socket. */
  resume(): void {
    if (!this.live || !this.paused) return;
    this.paused = false;
    this.live.pump?.armNextTurn();
    this.listeners.onStatus('listening');
  }

  /**
   * End the conversation, but let it finish speaking first.
   *
   * The microphone goes off in this call — that is what the press has to feel
   * like — while the socket, the queue and every turn in flight are left alone
   * until the last translation has been spoken. Only then does teardown run.
   *
   * This is the difference between ending a conversation and cutting one off.
   * {@link stop} does all of it at once, which is right when the page is going
   * away or the socket has already dropped, and wrong when a person pressed a
   * button: it discarded the translation of the sentence they had just finished
   * saying, mid-word, along with the turn the server was still working on.
   *
   * Asking a second time stops immediately. Someone who presses End twice is
   * telling you the tail is too long, and the honest answer is to cut it.
   */
  finish(): void {
    if (!this.live) return;
    if (this.finishing) {
      this.stop();
      return;
    }

    this.finishing = true;
    // Ending outranks a pause, and the flags must not both be set: `stop` clears
    // them together, but the status latch reads them independently.
    this.paused = false;
    const live = this.live;

    // Closed the ordinary way rather than abandoned, and NOT as a forced cut —
    // same reasoning as `pause`. This is what gets the last sentence translated
    // instead of swept by the server's idle sweep.
    live.pipeline?.closeCapturedTurn(false);
    live.pump?.armNextTurn();

    // Capture, and only capture. The context stays open because playback needs
    // it, and the socket stays open because the answer is still coming over it.
    live.source?.disconnect();
    if (live.node) live.node.port.onmessage = null;
    // Not ours to stop when the caller owns the stream — the extension hands in
    // a track it also uses elsewhere. Everything above is this session's own.
    if (this.deps.ownsAudioResources !== false) {
      live.stream?.getTracks().forEach((track) => track.stop());
    }

    this.listeners.onLevel(0);
    this.listeners.onMuted(false);
    this.listeners.onStatus('finishing');

    // A drain waits on the server and on a socket that can drop a message. The
    // deadline is what keeps a lost reply from leaving the UI saying "finishing"
    // with no way out but a reload; the queue's own stall watchdog is shorter,
    // so this only fires when that one did not resolve things either.
    this.drainTimer = setTimeout(() => this.stop(), DRAIN_TIMEOUT_MS);

    // Nothing may have been in flight at all, in which case this ends here.
    this.completeDrainIfDone();
  }

  /**
   * End the run for real, once the tail has finished.
   *
   * Called from every edge that can retire the last turn: playback falling
   * silent, and a turn closing with no audio to play.
   */
  private completeDrainIfDone(): void {
    if (!this.finishing || !this.live) return;
    // `isBusy` counts turns still queued, not only samples sounding — a turn
    // waiting on the server has not been spoken yet and must hold the drain.
    if (this.live.ordered?.isBusy) return;
    this.stop();
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
    // Not independent, though they read as two free settings. `armNextTurn()` is
    // the only thing that leaves `awaiting-result`, and it is only ever called on
    // the single-turn path — so `continuous: false` with several turns in flight
    // parks the pump in `awaiting-result` with nobody to release it, and the
    // microphone is dead for the rest of the conversation with nothing reported.
    // Derived rather than asserted: refusing to start is a worse answer to a
    // combination that has exactly one safe reading.
    const continuous = (runtime.continuous ?? false) || !singleTurn;
    if (runtime.continuous === false && !singleTurn) {
      this.listeners.onLog?.(
        `continuous capture forced on: maxInFlight=${maxInFlight} has no one to re-arm the microphone`,
      );
    }
    // Reported rather than refused: the combination is coherent only for a caller
    // whose playback cannot reach its own microphone, and one that is half duplex
    // is saying it can. Opting out of the pump's echo counting also opts out of
    // the signal its mute keys on, so this caller has no playback gating at all.
    if (runtime.ownsEchoMeasurement && runtime.fullDuplex !== true) {
      this.listeners.onLog?.(
        'ownsEchoMeasurement with half duplex: the microphone will not be gated on playback',
      );
    }

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
        onClosed: (code, reason) => {
          // Without a socket the conversation cannot continue, and leaving it
          // "listening" would strand the microphone muted mid-turn.
          //
          // The code is reported rather than swallowed so a deliberate
          // server-side close (4000-4999) is distinguishable from a network
          // drop. Nothing on the server emits one today — the token is checked
          // at the upgrade and not re-checked mid-stream — so this reads as a
          // plain drop until something does.
          this.listeners.onError(
            code >= 4000
              ? `Connection closed by the translator (${code}${reason ? `: ${reason}` : ''})`
              : 'Connection to the translator dropped',
          );
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
          // The edge a drain is usually waiting on: the tail just went silent.
          if (!playing) this.completeDrainIfDone();
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
            // Read here for the same reason, and independently of
            // `reportMetrics`: grouping the transcript is a display concern that
            // must work whether or not this run is being measured.
            this.reportTurnCapture(pipeline, turnId);
            // Every path ends here, so the ordering layer can never be left
            // waiting on a turn that will not arrive.
            ordered.finish(turnId);
            if (!isServerReason(reason)) this.abandonTurn(turnId, reason);
            if (singleTurn) {
              this.turnEnded = true;
              this.armIfTurnComplete();
            }
            // The other edge: a turn that ended with nothing to play retires
            // here rather than through the queue, so it never reports silence.
            this.completeDrainIfDone();
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
            this.emitStatus('hearing-speech');
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
              this.emitStatus('translating');
              this.listeners.onMuted(true);
            }
            // A cut turn ends mid-sentence, so its row has to say so rather than
            // leaving the quality drop looking like a pipeline fault.
            pipeline.closeCapturedTurn(reason === 'forced');
          },
          onLevel: (value) => {
            const now = Date.now();
            // Zero is exempt from the throttle, and has to be. The pump reports
            // it exactly ONCE per muted window — an edge, not a level — while
            // blocks arrive every ~21ms, so throttling at 100ms discards that
            // single report four times in five and the meter then sits at its
            // last reading for the whole window, which is precisely the frozen
            // needle the edge exists to prevent.
            if (value !== 0 && now - this.lastLevelAt < LEVEL_UPDATE_MS) return;
            this.lastLevelAt = now;
            this.listeners.onLevel(value);
          },
          // Forwarded only when several turns run at once. The single-turn path
          // already announces its own mute around the turn cycle, and reporting
          // both would change the event sequence `apps/web` was measured on.
          onMuted: (muted) => {
            if (!singleTurn) this.listeners.onMuted(muted);
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
          continuous,
          maxUtteranceMs: runtime.maxUtteranceMs,
          // The sink, not `ordered.isBusy` / `onPlaybackBusy`. `isBusy` is true
          // from the moment a turn OPENS — when someone starts talking — so a
          // microphone gate keyed on it stays shut for as long as any turn is in
          // flight, and says nothing while doing it. See the option's own
          // comment, and `apps/extension/src/sounding-sink.ts`, which reached
          // this the hard way.
          //
          // Omitted for a caller that owns the measurement: the pump would
          // otherwise count the people it is listening TO as echo.
          sounding: runtime.ownsEchoMeasurement ? undefined : () => playback.isPlaying,
        },
      );
      local.pump = pump;

      const node = this.deps.createWorkletNode(context);
      local.node = node;
      node.port.onmessage = (message: MessageEvent<Float32Array>) => {
        // Where a pause actually stops the microphone. Not `node.disconnect()`:
        // that severs only the worklet's OUTPUTS, and the worklet keeps posting a
        // block every ~21ms regardless — see the note on `local.source` below.
        // The consumer is the only place the flow can be cut.
        if (this.captureStopped) return;
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
      this.emitStatus('listening');
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
    // Before the status below, or the latch in `emitStatus` would be the last
    // thing standing between a torn-down session and a UI that still says it is
    // paused. Teardown outranks a pause, always — and outranks a drain, which is
    // how the second press of End cuts one short.
    this.paused = false;
    this.finishing = false;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;

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
    this.emitStatus('listening');
  }

  /**
   * Count one instance of our own playback being heard back, against the turn being
   * captured.
   *
   * Public because a caller may have its own microphone for this — the extension
   * does, because the tab it captures is not where the echo appears — and reports
   * through here so the count lands on the same per-turn field either way.
   *
   * It used to be public because the pump's own echo gate was unreachable in
   * continuous mode, that gate running only while capture was muted and
   * continuous mode never muting. That hole is closed: the gate now keys on
   * whether our audio is sounding, so the pump counts in both modes. This
   * override remains for the caller whose echo appears somewhere the pump's
   * microphone is not.
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
  /**
   * Hand capture's own view of a finished turn to whoever is rendering.
   *
   * Silent when the turn never got a session id — held at the in-flight ceiling
   * and dropped before the server opened it. There is no transcript segment for
   * such a turn either, so there is nothing for this to join to.
   */
  private reportTurnCapture(pipeline: TurnPipeline, turnId: string): void {
    const captured = pipeline.metricsFor(turnId);
    if (!captured?.sessionId) return;
    this.listeners.onTurnCaptured?.({
      sessionId: captured.sessionId,
      cutForced: captured.cutForced,
      openedAt: captured.openedAt,
      closedAt: captured.closedAt,
    });
  }

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
        this.emitStatus('playing');
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
 *
 * **Every reason the server can send is named here.** `server.session.ended.reason`
 * is `z.string()` on the wire, so the final `error` has to stay as a default for
 * a reason this build predates — but a KNOWN reason reaching it is a bug, and one
 * that already shipped: `voice_off` fell through and filed every text-only turn
 * as a failure. Measured in production on 2026-08-31, all 21 client rows said
 * `error` while the server reported `completed: true`. The server's close reasons
 * come from `translation-session.service.ts` (`close(...)` call sites) and
 * `ClauseDelivery.stoppedBy`; adding one there means adding it here.
 */
function outcomeFor(reason: string, wasHeard: boolean): TurnOutcome {
  if (reason === 'too_many_turns') return 'rejected';
  if (reason === 'dropped_pending' || reason === 'backlog' || reason === 'stalled') {
    return 'dropped';
  }
  // The listener heard less than the whole turn, or left before it arrived.
  // Delivery failed; the turn itself did not.
  if (reason === 'unsupported_audio' || reason === 'client_gone') return 'dropped';
  if (reason === 'no_audio') return 'no_audio';
  // `voice_off` is a SUCCESSFUL turn that was never meant to be spoken
  // (`turn-timeline.ts` states it in those words), so it shares `completed`'s
  // rule rather than getting its own: with speech off nothing is heard and this
  // yields `no_audio`, and if audio somehow did play `played` is still right.
  if (reason === 'completed' || reason === 'voice_off') {
    return wasHeard ? 'played' : 'no_audio';
  }
  // Named, not defaulted: the server pairs this with a `turn_abandoned` failure.
  if (reason === 'idle_timeout') return 'error';
  return 'error';
}
