import type { TranslationDirection } from '@chatofy/types';
import type { PlaybackSink } from '@chatofy/realtime-client';
import { CASCADE_STREAMING, type DirectionSessionDeps } from './direction-session';
import { DuckController } from './duck-controller';
import type { EchoMonitorDeps } from './echo-monitor';
import { MeetingTranscript } from './meeting-transcript';
import type { GatedMicrophone } from './outbound-mic';
import type { VoiceHold } from './outbound-voice-lease';
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
  start(options: {
    direction: TranslationDirection;
    voiceGender: string;
    /** Speak settled clauses mid-turn instead of waiting for the turn to end. */
    streaming: boolean;
  }): Promise<void>;
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
  /**
   * Where the user's translated speech goes when the meeting page can carry it.
   *
   * Absent, or a page without the patch, and the outbound direction monitors
   * through this machine's speakers instead — which is a different thing, and is
   * named differently everywhere the user can see it.
   */
  createPageSink?: (onTurnDrained: (turnKey: string) => void) => PlaybackSink;
  /**
   * Hold the user's own voice out of the meeting while their translation is what
   * the other participants hear.
   *
   * Separate from {@link createPageSink} because it outlives every turn: the
   * voice is held for the whole session, and the hold has to be renewed rather
   * than set, so a document that dies gives the microphone back.
   */
  holdOutboundVoice?: VoiceHold;
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

  /**
   * Whether the meeting client is still transmitting the track it was handed.
   *
   * Starts false and is only ever raised by the page reporting it. Guessing the
   * other way round would mean translating and sending speech during the moment
   * a user muted themselves to say something private.
   */
  private transmitting = false;

  /** Set at capture open: does this tab's page world carry the patch. */
  private sending = false;

  /**
   * Set at capture open: is this capture running the continuous backend.
   *
   * Read by {@link applyMicrophoneGate} and nowhere else. Everything else about
   * a direction is behind `DirectionRunner` on purpose; this one fact cannot be,
   * because the gate's rule is not about a session at all — it is about whether
   * playback has gaps, and only the mode answers that.
   */
  private live = false;

  /** Held so a mute can drop audio already on its way to the meeting. */
  private pageSink: PlaybackSink | null = null;

  private outboundState(): OutboundState {
    // Driven by whether the direction is actually running, not by what was
    // decided when capture opened: a session that died would otherwise leave the
    // user believing they are being translated for the rest of the call.
    if (!this.directions.outbound) return 'off';
    if (!this.sending) return 'monitor';
    // Named rather than folded into `sending`: while the client is muted nothing
    // is captured at all, and telling the user their speech is reaching the
    // meeting at that moment is the one lie this state exists to prevent.
    return this.transmitting ? 'sending' : 'muted';
  }

  /**
   * The meeting client muted, or unmuted, the microphone we composed.
   *
   * Muted stops the outbound direction at the source rather than only silencing
   * it downstream: the point is that speech the user believes is private is
   * never captured, never translated, and never leaves this document.
   */
  setTransmitting(transmitting: boolean): void {
    if (this.transmitting === transmitting) return;
    this.transmitting = transmitting;
    this.applyMicrophoneGate();
    // Anything already synthesized is dropped rather than allowed to finish.
    // Closing the gate stops new speech being captured; this stops the sentence
    // that was in flight when the user reached for mute.
    if (!transmitting) this.pageSink?.stop();
    this.reportStatus();
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

  /**
   * Keep the microphone shut while any translation is audible — and while the
   * meeting client has muted us, when the translation is going to the meeting.
   *
   * The second condition is the privacy rule. Once the outbound translation is
   * being sent rather than monitored, a muted client means the user expects
   * nothing to leave; capturing anyway would translate it and hand it to the
   * page. While merely monitoring, mute is the meeting's business and not ours.
   */
  private applyMicrophoneGate(): void {
    // The outbound translation only feeds back into this microphone when it
    // plays through these speakers. Once it is going to the meeting instead,
    // gating on it would mute the user for the length of their own translation
    // and halve how often they can speak, for no acoustic reason at all.
    const audible = this.sounding.inbound || (this.sounding.outbound && !this.sending);
    const muted = this.sending && !this.transmitting;
    // The echo half of the gate assumes playback has gaps to reopen in. The
    // continuous backend has none — it trails the speaker by seconds and talks
    // through their pauses — so applying it there does not quieten the
    // microphone between sentences, it holds it at zero from the first
    // translated sample to the end of the meeting. Measured as: the user gets
    // one sentence, and nothing after it is ever heard.
    //
    // So live mode trades the echo gate for headphones, which is the same trade
    // the web's live page already asks for in writing, and the popup says so
    // where the mode is chosen. `echoCancellation` stays on either way; it is
    // what makes the trade survivable on a laptop speaker rather than exact.
    //
    // The MUTE half is not part of the trade and applies in both modes: speech
    // the user believes is private must never be captured whatever the backend.
    this.shared?.microphone?.setSuppressed((audible && !this.live) || muted);
  }

  async begin(streamId: string, settings: CaptureSettings, patched = false): Promise<void> {
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
    // Sending needs both a page that can carry it and somewhere to send it to.
    this.sending = patched && settings.outbound && this.deps.createPageSink !== undefined;
    this.live = settings.mode === 'live';
    // Not yet heard from the page. Until it says otherwise, assume muted.
    this.transmitting = false;

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

      const echo = this.buildEchoMonitor(context, inboundRef);

      this.shared = { context, duck, echo, tabStream: tab.stream };

      this.endCaptureIfTabGoesAway(tab.stream);

      const inbound = this.buildDirection('inbound', context, settings, tab.stream, duck);
      inboundRef.current = inbound;
      this.directions.inbound = inbound;
      await inbound.start({
        direction: settings.direction,
        voiceGender: settings.voiceGender,
        // Both directions read the same constant. Turning on mid-turn playback
        // for what the meeting says while leaving it off for what this user says
        // would give the two sides of one conversation different latency, which
        // is confusing in exactly the way a translator must not be.
        streaming: CASCADE_STREAMING,
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

  /**
   * The microphone that hears our own translation come back out of the speakers.
   *
   * Takes a holder rather than the session, because the echo measurement is built
   * before the inbound session and has to reach it afterwards: the count lands on
   * that session's per-turn field, and the monitor needs `isPlaying` at
   * construction.
   */
  private buildEchoMonitor(
    context: AudioContext,
    inboundRef: { current: DirectionRunner | undefined },
  ): EchoRunner {
    return this.deps.createEcho({
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
  }

  /**
   * End the capture when the tab it came from goes away.
   *
   * A captured tab that reloads, navigates or closes ends this track, and nothing
   * else here would notice. The microphone lives in THIS document, not in that
   * tab, so it survives — the outbound direction keeps capturing, translating and
   * publishing transcript while the meeting itself stopped arriving. What the user
   * sees is their own speech appearing on screen, which reads as the feature
   * working, over a capture that is half dead and sending nothing to anyone.
   *
   * Ended rather than repaired: the stream id is single-use and the new document
   * needs its own, minted by the worker from a fresh invocation.
   */
  private endCaptureIfTabGoesAway(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        this.errors.inbound = 'The meeting tab was reloaded or closed. Start Chatofy on it again.';
        void this.end().then(() => this.reportStatus());
      });
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
      // Applied immediately, before a single block can be captured. The gate is
      // otherwise only touched by an event, and the first event may be a whole
      // sentence away — during which a client that is muted would have had the
      // user's speech captured and translated anyway.
      this.applyMicrophoneGate();

      const outbound = this.buildDirection('outbound', context, settings, microphone.stream, duck);
      this.directions.outbound = outbound;
      await outbound.start({
        direction: reverseDirection(settings.direction),
        voiceGender: settings.voiceGender,
        streaming: CASCADE_STREAMING,
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
      // Only the outbound direction can be sent into the meeting, and only when
      // the page can carry it. Everything else plays here.
      createSink:
        !inbound && this.sending && this.deps.createPageSink
          ? (onTurnDrained) => {
              const sink = this.deps.createPageSink!(onTurnDrained);
              this.pageSink = sink;
              // From here the meeting hears the translation instead of the user,
              // not on top of them. Started with the sink because this is the
              // one place that knows the page can actually carry the audio —
              // holding the voice down where it cannot would leave the meeting
              // with neither.
              this.deps.holdOutboundVoice?.hold();
              return sink;
            }
          : undefined,
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
    // The user gets their own voice back the moment this direction stops, rather
    // than a lease later. Every teardown path runs through here.
    if (direction === 'outbound') {
      this.deps.holdOutboundVoice?.release();
      this.pageSink = null;
    }
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
    // Restated outside `stopDirection`, which returns early when there is no
    // session to stop. A start that got as far as the page sink and no further
    // has a voice held down and nothing that would give it back.
    this.deps.holdOutboundVoice?.release();
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
    // Same backstop as `endOutbound`: a capture torn down before its outbound
    // session existed must still hand the microphone back.
    this.deps.holdOutboundVoice?.release();

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
