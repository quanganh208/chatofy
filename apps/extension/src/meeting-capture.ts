import type { TranslationDirection } from '@chatofy/types';
import type { DirectionSessionDeps } from './direction-session';
import { DuckController } from './duck-controller';
import type { EchoMonitorDeps } from './echo-monitor';
import { MeetingTranscript } from './meeting-transcript';
import type { GatedMicrophone } from './outbound-mic';
import type { TabAudioSource } from './tab-audio-source';
import { reverseDirection } from './translation-direction';
import type { CaptureSettings, CaptureStatus, OutboundState, TranscriptLine } from './messages';

/**
 * Both directions of one meeting: what to open, what to release, and in which
 * order.
 *
 * Kept apart from the offscreen entrypoint so the ORDER can be tested. Everything
 * that matters here is a sequencing decision — the meeting must be audible before
 * anything waits on a human, a microphone the user refuses must not cost them the
 * direction that already works, and a teardown that re-enters itself must stop.
 * None of those are observable from the outside once they are wired into
 * `chrome.runtime` listeners and browser globals, and all three were wrong in the
 * first draft.
 *
 * The browser lives entirely in {@link MeetingCaptureDeps}. What is left is the
 * sequencing, which is the part that has been getting this wrong.
 */

/**
 * Turns each direction keeps open at the server.
 *
 * The inbound three is what continuous capture needs at an ~8s forced cut and a
 * p95 near 2s. The outbound two is provisional and deliberately smaller: both
 * directions share one process-wide ceiling of six, and the sidecars lock per
 * ENGINE rather than per process, so a Vietnamese turn and an English turn are
 * genuinely concurrent inferences rather than two entries in one queue. Phase 3
 * measures what the pair actually costs; until then this leaves headroom instead
 * of claiming there is none.
 */
const MAX_IN_FLIGHT_INBOUND = 3;
const MAX_IN_FLIGHT_OUTBOUND = 2;

/** All this class needs from a running conversation. */
export interface DirectionRunner {
  start(options: { direction: TranslationDirection; voiceGender: string }): Promise<void>;
  stop(): void;
  noteEchoHeard(): void;
}

/** All this class needs from the echo measurement. */
export interface EchoRunner {
  start(): Promise<void>;
  stop(): void;
  readonly echoEvents: number;
}

export interface MeetingCaptureDeps {
  createContext: () => AudioContext;
  openTab: (context: AudioContext, streamId: string) => Promise<TabAudioSource>;
  openMicrophone: (context: AudioContext) => Promise<GatedMicrophone>;
  createEcho: (deps: EchoMonitorDeps) => EchoRunner;
  createSession: (deps: DirectionSessionDeps) => DirectionRunner;
  workletUrl: string;
  onStatus: (status: CaptureStatus) => void;
  onTranscript: (lines: TranscriptLine[]) => void;
}

/** What both directions share. Only a full stop may release these. */
interface SharedLive {
  context: AudioContext;
  duck: DuckController;
  echo: EchoRunner;
  tabStream: MediaStream;
  microphone?: GatedMicrophone;
}

type Direction = 'inbound' | 'outbound';

export class MeetingCapture {
  private shared: SharedLive | null = null;
  private readonly directions: Record<Direction, DirectionRunner | null> = {
    inbound: null,
    outbound: null,
  };

  /**
   * Identifies the current {@link begin} run.
   *
   * A stop arriving while a start is parked on the microphone permission prompt —
   * which waits for a human, so seconds, not milliseconds — would otherwise find
   * nothing to tear down and let the start install a live graph behind it: a
   * microphone and a tab capture with no way left to reach them, and Chrome's
   * recording indicator lit over both.
   */
  private generation = 0;

  /**
   * Whether each direction has audio queued or sounding right now.
   *
   * Two fields, not one, and which consumer reads which is a contract rather than
   * a detail:
   *
   *   the microphone gate  ← inbound || outbound, while the outbound direction
   *                          monitors through these same loudspeakers
   *   the echo measurement ← inbound only, so the count keeps meaning "our
   *                          translation came back" and not "the user talked"
   *
   * Ducking reads neither — it follows `OrderedPlayback.isBusy` through
   * {@link busy}, for the reason recorded in `duck-controller.ts`.
   */
  private readonly sounding = { inbound: false, outbound: false };

  /** Turns queued or waiting per direction, from `isBusy`. Ducking's signal. */
  private readonly busy = { inbound: false, outbound: false };

  private readonly errors: { inbound?: string; outbound?: string } = {};

  private readonly transcript = new MeetingTranscript();

  constructor(private readonly deps: MeetingCaptureDeps) {}

  get isCapturing(): boolean {
    return this.shared !== null;
  }

  private outboundState(): OutboundState {
    // Driven by whether the direction is actually running, not by what was
    // decided when capture opened: a session that died would otherwise leave the
    // user believing they are being translated for the rest of the call.
    return this.directions.outbound ? 'monitor' : 'off';
  }

  reportStatus(): void {
    const capturing = this.shared !== null;
    this.deps.onStatus({
      capturing,
      outbound: capturing ? this.outboundState() : 'off',
      errors: { ...this.errors },
      backlogTurns: this.transcript.liveTurns,
      echoEvents: this.shared?.echo.echoEvents ?? 0,
    });
  }

  private publishTranscript(): void {
    // One message for the whole set. A message per line meant ~100 IPC
    // round-trips and ~100 full overlay rebuilds per second with turns emitting
    // partials.
    this.deps.onTranscript(this.transcript.lines());
  }

  /** Keep the microphone shut while any translation is audible. */
  private applyMicrophoneGate(): void {
    this.shared?.microphone?.setSuppressed(this.sounding.inbound || this.sounding.outbound);
  }

  async begin(streamId: string, settings: CaptureSettings): Promise<void> {
    // Claimed BEFORE the first await, not after. `end()` below suspends, and a
    // stop arriving in that window would bump a generation this run had not taken
    // yet — so the run would then claim a number one higher, match itself, and
    // install a live graph behind a stop that had already happened.
    const run = ++this.generation;
    const stale = () => this.generation !== run;

    await this.end();
    delete this.errors.inbound;
    delete this.errors.outbound;
    this.transcript.clear();

    const context = this.deps.createContext();

    // Held here so the failure path can release what was built before `shared`
    // exists to hold it. After that point teardown is `end()`'s job, and doing it
    // here as well would close the same context twice.
    let tabStream: MediaStream | null = null;

    try {
      // Opened here rather than inside a session, because a session's
      // `openMicrophone` is what feeds the translator and this is the tab. One
      // context for all of it, and this class owns it: sessions are given
      // `ownsAudioResources: false` precisely so neither can close what the
      // meeting's own passthrough depends on.
      const tab = await this.deps.openTab(context, streamId);
      tabStream = tab.stream;

      // Created suspended when there was no user gesture. Left that way,
      // `currentTime` never advances, so nothing scheduled ever plays and no
      // `onended` ever fires — the meeting would be silent and every turn would
      // eventually hit the stall watchdog, which looks identical to a pipeline
      // fault in the logs.
      if (context.state === 'suspended') await context.resume();
      if (stale()) throw new Error('capture was stopped while starting');

      const duck = new DuckController(context);
      // FIRST, before anything that can wait on a human. The captured tab is
      // muted for the user by the act of capturing it, so until this line the
      // meeting is silent — and the microphone permission prompt below can hold
      // for seconds.
      duck.connect(tab.node, context.destination);

      // A holder, because the echo measurement is built before the inbound
      // session and has to reach it afterwards: the count lands on that session's
      // per-turn field, and the monitor needs `isPlaying` at construction.
      const inboundRef: { current: DirectionRunner | undefined } = { current: undefined };

      const echo = this.deps.createEcho({
        context,
        workletUrl: this.deps.workletUrl,
        // Audible playback, and inbound only. Echo is our own translation coming
        // back, which can only happen while it is actually sounding — `isBusy`
        // would open the window when the remote speaker STARTS talking, counting
        // anything the user said before a single translated sample existed.
        isPlaying: () => this.sounding.inbound,
        onEchoHeard: () => {
          // Routed through the session so it lands on the turn being captured and
          // reaches the metrics row. The pump's own echo gate is unreachable in
          // continuous mode — it only runs while capture is muted, and continuous
          // mode never mutes — so this microphone is the only source of the
          // number.
          //
          // Deliberately does NOT report status: this fires per ~21ms block, and
          // a status push costs an IPC round trip plus a `chrome.tabs.query`
          // behind the menu title. The count rides the next status instead.
          inboundRef.current?.noteEchoHeard();
        },
      });

      this.shared = { context, duck, echo, tabStream: tab.stream };

      const inbound = this.buildDirection('inbound', context, settings, tab.stream, duck);
      inboundRef.current = inbound;
      this.directions.inbound = inbound;
      await inbound.start({
        direction: settings.direction,
        voiceGender: settings.voiceGender,
      });
      if (stale()) throw new Error('capture was stopped while starting');

      // Only now, with the meeting audible and its direction running. Everything
      // below fails on its own.
      if (settings.outbound) await this.startOutbound(context, settings, duck, stale);

      await echo.start();
      this.reportStatus();
    } catch (err) {
      if (this.shared) {
        // The graph is installed, so `end()` is what knows how to take it down.
        await this.end();
      } else {
        tabStream?.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => undefined);
      }
      throw err;
    }
  }

  /** Open the microphone and start translating it. Failure costs only itself. */
  private async startOutbound(
    context: AudioContext,
    settings: CaptureSettings,
    duck: DuckController,
    stale: () => boolean,
  ): Promise<void> {
    let microphone: GatedMicrophone | null = null;
    try {
      microphone = await this.deps.openMicrophone(context);
      if (stale() || !this.shared) {
        microphone.stop();
        return;
      }
      this.shared.microphone = microphone;

      const outbound = this.buildDirection('outbound', context, settings, microphone.stream, duck);
      this.directions.outbound = outbound;
      await outbound.start({
        direction: reverseDirection(settings.direction),
        voiceGender: settings.voiceGender,
      });
    } catch (err) {
      this.errors.outbound =
        err instanceof Error ? err.message : 'Could not translate your microphone';
      microphone?.stop();
      if (this.shared) this.shared.microphone = undefined;
      this.endOutbound();
    }
  }

  /** Wire one direction into the shared graph. */
  private buildDirection(
    direction: Direction,
    context: AudioContext,
    settings: CaptureSettings,
    input: MediaStream,
    duck: DuckController,
  ): DirectionRunner {
    const inbound = direction === 'inbound';
    return this.deps.createSession({
      context,
      workletUrl: this.deps.workletUrl,
      settings,
      // The user speaks the language the meeting is being translated INTO.
      direction: inbound ? settings.direction : reverseDirection(settings.direction),
      input,
      maxInFlight: inbound ? MAX_IN_FLIGHT_INBOUND : MAX_IN_FLIGHT_OUTBOUND,
      onServerEvent: (event) => {
        this.transcript.apply(direction, event);
        this.publishTranscript();
      },
      onReset: () => this.transcript.reset(direction),
      onTurnAbandoned: (sessionId) => {
        // A turn refused at the ceiling or dropped at a backlog ceiling produces
        // no `server.session.ended`, so without this its live line would sit on
        // the overlay for the rest of the meeting.
        this.transcript.apply(direction, {
          type: 'transcript.turnAbandoned',
          sessionId: sessionId ?? undefined,
        });
        this.publishTranscript();
      },
      onError: (message) => {
        this.errors[direction] = message;
        this.reportStatus();
      },
      onBusy: (value) => {
        this.busy[direction] = value;
        // Ducking lowers what the USER is listening to. The outbound translation
        // is not for them — it is a monitor of what the other participants will
        // hear — so it never touches the meeting's volume.
        if (inbound) duck.setBusy(value);
      },
      onSounding: (value) => {
        this.sounding[direction] = value;
        this.applyMicrophoneGate();
      },
      onLog: (message) => console.info(`[chatofy] ${direction}: ${message}`),
      onStopped: () => {
        // Asymmetric on purpose. Losing the outbound direction costs the user the
        // ability to be understood; losing the inbound one means the capture is
        // translating nothing at all, so it ends rather than leaving a recording
        // indicator lit over a dead pipeline.
        if (inbound) void this.end();
        else this.endOutbound();
      },
    });
  }

  /** Release one direction's session, and nothing else. */
  private stopDirection(direction: Direction): void {
    const session = this.directions[direction];
    if (!session) return;
    // Cleared BEFORE stopping: `stop()` fires `onStopped`, which lands back here.
    this.directions[direction] = null;
    session.stop();
    this.sounding[direction] = false;
    this.busy[direction] = false;
    if (direction === 'inbound') this.shared?.duck.setBusy(false);
    this.applyMicrophoneGate();
  }

  /**
   * End the outbound direction, keeping the meeting's translation running.
   *
   * The transcript is deliberately left alone. A dropped socket is exactly when
   * the user wants to read what was said, and clearing it here would erase the
   * meeting at the moment something went wrong.
   */
  endOutbound(): void {
    const wasRunning = this.directions.outbound !== null || this.shared?.microphone !== undefined;
    this.stopDirection('outbound');
    if (this.shared) {
      // The microphone belongs to this direction alone; leaving it open would
      // hold Chrome's recording indicator lit for a direction that has stopped.
      this.shared.microphone?.stop();
      this.shared.microphone = undefined;
    }
    if (wasRunning) this.reportStatus();
  }

  /**
   * Release everything.
   *
   * Idempotent, and it has to be: the inbound session's `onStopped` calls this,
   * and this calls that session's `stop()`. Clearing `shared` first is what makes
   * the re-entrant call a no-op instead of a second teardown of the same context.
   */
  async end(): Promise<void> {
    const current = this.shared;
    this.shared = null;

    this.stopDirection('inbound');
    this.stopDirection('outbound');

    if (!current) return;

    current.echo.stop();
    current.duck.release();
    current.duck.disconnect();
    current.microphone?.stop();
    // This class's to release, because it opened them. Sessions are given
    // `ownsAudioResources: false` so neither can close them out from under the
    // meeting's passthrough on a dropped socket.
    current.tabStream.getTracks().forEach((track) => track.stop());
    await current.context.close().catch(() => undefined);
    this.reportStatus();
  }

  /** A stop that also abandons a start still waiting on the microphone. */
  async stop(): Promise<void> {
    this.generation += 1;
    await this.end();
  }

  /** Record a failure that killed the whole capture. */
  noteStartFailure(message: string): void {
    this.errors.inbound = message;
  }
}
