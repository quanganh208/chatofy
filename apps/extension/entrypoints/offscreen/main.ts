import { ConversationSession } from '@chatofy/realtime-client';
import { createDirectionSession } from '../../src/direction-session';
import { DuckController } from '../../src/duck-controller';
import { EchoMonitor } from '../../src/echo-monitor';
import { MeetingTranscript } from '../../src/meeting-transcript';
import { openGatedMicrophone, type GatedMicrophone } from '../../src/outbound-mic';
import { openTabAudio } from '../../src/tab-audio-source';
import { reverseDirection } from '../../src/translation-direction';
import { forContext, type CaptureSettings, type OutboundState } from '../../src/messages';

/**
 * The audio graph, and the only place in the extension that translates anything.
 *
 * Everything below the message handling is `@chatofy/realtime-client`, unchanged
 * from what the web page uses. The turn-taking policy, the concurrency, the
 * ordering and the metrics all live there; this file supplies the browser APIs
 * and the things that are genuinely specific to a meeting — where the input comes
 * from, that the original has to be played back, and that a real microphone is
 * still open somewhere the extension does not control.
 *
 * TWO directions run here, and the difference between them is four fields (see
 * `direction-session.ts`). What matters in this file is that nothing is shared
 * between them by accident. Every piece of state below is either explicitly
 * shared — the `AudioContext` — or explicitly split in two, because a single flag
 * written by both is not a tidier version of two flags. It is a bug with a
 * specific shape: the outbound turn finishing 200ms after the inbound one starts
 * would report "nothing is playing", un-duck the meeting mid-sentence and reopen
 * the microphone into our own loudspeaker, which is the loop this whole
 * architecture exists to remove.
 *
 * The two are NOT symmetric in one respect, and it is deliberate. Losing the
 * outbound direction costs the user the ability to be understood; losing the
 * inbound one means the capture is translating nothing at all, so it ends the
 * capture rather than leaving a recording indicator lit over a dead pipeline.
 */

const WORKLET_PATH = 'worklets/mic-capture-processor.js';

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

/** What both directions share. Only a full stop may release these. */
interface SharedLive {
  context: AudioContext;
  duck: DuckController;
  echo: EchoMonitor;
  tabStream: MediaStream;
  microphone?: GatedMicrophone;
}

let shared: SharedLive | null = null;
const directions: Record<'inbound' | 'outbound', ConversationSession | null> = {
  inbound: null,
  outbound: null,
};

/**
 * Identifies the current `begin()` run.
 *
 * A stop arriving while a start is parked on the microphone permission prompt —
 * which waits for a human, so seconds, not milliseconds — would otherwise find
 * nothing to tear down and let the start install a live graph behind it: a
 * microphone and a tab capture with no way left to reach them, and Chrome's
 * recording indicator lit over both.
 */
let generation = 0;

/**
 * Whether each direction has audio queued or sounding right now.
 *
 * Two fields, not one, and which consumer reads which is a contract rather than
 * a detail:
 *
 *   the microphone gate  ← inbound || outbound, while the outbound direction
 *                          monitors through these same loudspeakers
 *   `EchoMonitor`        ← inbound only, so the count keeps meaning "our
 *                          translation came back" and not "the user talked"
 *
 * Ducking reads neither of these — it follows `OrderedPlayback.isBusy` through
 * {@link busy}, for the reason recorded in `duck-controller.ts`.
 */
const sounding = { inbound: false, outbound: false };

/** Turns queued or waiting per direction, from `isBusy`. Ducking's signal. */
const busy = { inbound: false, outbound: false };

/** Failures per direction, held here because each is cleared only by its own. */
const errors: { inbound?: string; outbound?: string } = {};

const transcript = new MeetingTranscript();

const send = (message: unknown) => {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
};

function outboundState(): OutboundState {
  // Driven by whether the direction is actually running, not by what was decided
  // when capture opened: a session that died leaves the user believing they are
  // being translated for the rest of the call.
  return directions.outbound ? 'monitor' : 'off';
}

function reportStatus(): void {
  const capturing = shared !== null;
  send({
    to: 'worker',
    type: 'status',
    status: {
      capturing,
      outbound: capturing ? outboundState() : 'off',
      errors: { ...errors },
      backlogTurns: transcript.liveTurns,
      echoEvents: shared?.echo.echoEvents ?? 0,
    },
  });
}

function publishTranscript(): void {
  // One message for the whole set. A message per line meant ~100 IPC round-trips
  // and ~100 full overlay rebuilds per second with turns emitting partials.
  send({ to: 'worker', type: 'transcript', lines: transcript.lines() });
}

/** Keep the microphone shut while any translation is audible. */
function applyMicrophoneGate(): void {
  shared?.microphone?.setSuppressed(sounding.inbound || sounding.outbound);
}

/** Wire one direction into the shared graph. */
function buildDirection(
  direction: 'inbound' | 'outbound',
  context: AudioContext,
  workletUrl: string,
  settings: CaptureSettings,
  input: MediaStream,
  duck: DuckController,
): ConversationSession {
  const inbound = direction === 'inbound';
  return createDirectionSession({
    context,
    workletUrl,
    settings,
    // The user speaks the language the meeting is being translated INTO.
    direction: inbound ? settings.direction : reverseDirection(settings.direction),
    input,
    maxInFlight: inbound ? MAX_IN_FLIGHT_INBOUND : MAX_IN_FLIGHT_OUTBOUND,
    onServerEvent: (event) => {
      transcript.apply(direction, event);
      publishTranscript();
    },
    onReset: () => transcript.reset(direction),
    onTurnAbandoned: (sessionId) => {
      // A turn refused at the ceiling or dropped at a backlog ceiling produces no
      // `server.session.ended`, so without this its live line would sit on the
      // overlay for the rest of the meeting.
      transcript.apply(direction, {
        type: 'transcript.turnAbandoned',
        sessionId: sessionId ?? undefined,
      });
      publishTranscript();
    },
    onError: (message) => {
      errors[direction] = message;
      reportStatus();
    },
    onBusy: (value) => {
      busy[direction] = value;
      // Ducking lowers what the USER is listening to. The outbound translation is
      // not for them — it is a monitor of what the other participants will hear —
      // so it never touches the meeting's volume.
      if (inbound) duck.setBusy(value);
    },
    onSounding: (value) => {
      sounding[direction] = value;
      applyMicrophoneGate();
    },
    onLog: (message) => console.info(`[chatofy] ${direction}: ${message}`),
    onStopped: () => {
      // Asymmetric on purpose — see the note at the top of this file.
      if (inbound) void end();
      else endOutbound();
    },
  });
}

async function begin(streamId: string, settings: CaptureSettings): Promise<void> {
  await end();
  delete errors.inbound;
  delete errors.outbound;
  transcript.clear();

  const run = ++generation;
  const stale = () => generation !== run;

  const context = new AudioContext();
  const workletUrl = chrome.runtime.getURL(WORKLET_PATH);

  // Held here so the failure path can release whatever was built before `shared`
  // exists to hold it. After that point teardown is `end()`'s job and doing it
  // here as well would close the same context twice.
  let tabStream: MediaStream | null = null;

  try {
    // Opened here rather than inside a session, because a session's
    // `openMicrophone` is what feeds the translator and this is the tab. One
    // context for all of it, and this file owns it: sessions are given
    // `ownsAudioResources: false` precisely so neither can close what the
    // meeting's own passthrough depends on.
    const tab = await openTabAudio(context, streamId);
    tabStream = tab.stream;

    // Created suspended when there was no user gesture. Left that way,
    // `currentTime` never advances, so nothing scheduled ever plays and no
    // `onended` ever fires — the meeting would be silent and every turn would
    // eventually hit the stall watchdog, which looks identical to a pipeline
    // fault in the logs.
    if (context.state === 'suspended') await context.resume();
    if (stale()) throw new Error('capture was stopped while starting');

    const duck = new DuckController(context);
    // FIRST, before anything that can wait on a human. The captured tab is muted
    // for the user by the act of capturing it, so until this line the meeting is
    // silent — and the microphone permission prompt below can hold for seconds.
    duck.connect(tab.node, context.destination);

    // A holder, because the echo monitor is built before the inbound session and
    // has to reach it afterwards: the count lands on that session's per-turn
    // field, and the monitor needs `isPlaying` at construction.
    const inboundRef: { current: ConversationSession | undefined } = { current: undefined };

    const echo = new EchoMonitor({
      context,
      workletUrl,
      // Audible playback, and inbound only. Echo is our own translation coming
      // back, which can only happen while it is actually sounding — `isBusy`
      // would open the window when the remote speaker STARTS talking, counting
      // anything the user said before a single translated sample existed.
      isPlaying: () => sounding.inbound,
      onEchoHeard: () => {
        // Routed through the session so it lands on the turn being captured and
        // reaches the metrics row. The pump's own echo gate is unreachable in
        // continuous mode — it only runs while capture is muted, and continuous
        // mode never mutes — so this microphone is the only source of the number.
        //
        // Deliberately does NOT report status: this fires per ~21ms block, and a
        // status push costs an IPC round trip plus a `chrome.tabs.query` behind
        // the menu title. The count rides along on the next status instead.
        inboundRef.current?.noteEchoHeard();
      },
    });

    shared = { context, duck, echo, tabStream: tab.stream };

    const inbound = buildDirection('inbound', context, workletUrl, settings, tab.stream, duck);
    inboundRef.current = inbound;
    directions.inbound = inbound;
    await inbound.start({
      direction: settings.direction,
      voiceGender: settings.voiceGender,
    });
    if (stale()) throw new Error('capture was stopped while starting');

    // Only now, with the meeting audible and its direction running. Everything
    // below fails on its own: a microphone the user refuses must not cost them
    // the direction that already works.
    if (settings.outbound) await startOutbound(context, workletUrl, settings, duck, stale);

    await echo.start();
    reportStatus();
  } catch (err) {
    if (shared) {
      // The graph is installed, so it is `end()` that knows how to take it down.
      await end();
    } else {
      tabStream?.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
    }
    throw err;
  }
}

/** Open the microphone and start translating it. Failure costs only itself. */
async function startOutbound(
  context: AudioContext,
  workletUrl: string,
  settings: CaptureSettings,
  duck: DuckController,
  stale: () => boolean,
): Promise<void> {
  let microphone: GatedMicrophone | null = null;
  try {
    microphone = await openGatedMicrophone(context);
    if (stale() || !shared) {
      microphone.stop();
      return;
    }
    shared.microphone = microphone;

    const outbound = buildDirection(
      'outbound',
      context,
      workletUrl,
      settings,
      microphone.stream,
      duck,
    );
    directions.outbound = outbound;
    await outbound.start({
      direction: reverseDirection(settings.direction),
      voiceGender: settings.voiceGender,
    });
  } catch (err) {
    errors.outbound = err instanceof Error ? err.message : 'Could not translate your microphone';
    microphone?.stop();
    if (shared) shared.microphone = undefined;
    endOutbound();
  }
}

/** Release one direction's session, and nothing else. */
function stopDirection(direction: 'inbound' | 'outbound'): void {
  const session = directions[direction];
  if (!session) return;
  // Cleared BEFORE stopping: `stop()` fires `onStopped`, which lands back here.
  directions[direction] = null;
  session.stop();
  sounding[direction] = false;
  busy[direction] = false;
  if (direction === 'inbound') shared?.duck.setBusy(false);
  applyMicrophoneGate();
}

/**
 * End the outbound direction, keeping the meeting's translation running.
 *
 * The transcript is deliberately left alone. A dropped socket is exactly when the
 * user wants to read what was said, and clearing it here would erase the meeting
 * at the moment something went wrong.
 */
function endOutbound(): void {
  const wasRunning = directions.outbound !== null || shared?.microphone !== undefined;
  stopDirection('outbound');
  if (shared) {
    // The microphone belongs to this direction alone; leaving it open would hold
    // Chrome's recording indicator lit for a direction that has stopped.
    shared.microphone?.stop();
    shared.microphone = undefined;
  }
  if (wasRunning) reportStatus();
}

/**
 * Release everything.
 *
 * Idempotent, and it has to be: the inbound session's `onStopped` calls this, and
 * this calls that session's `stop()`. Clearing `shared` first is what makes the
 * re-entrant call a no-op instead of a second teardown of the same context.
 */
async function end(): Promise<void> {
  const current = shared;
  shared = null;

  stopDirection('inbound');
  stopDirection('outbound');

  if (!current) return;

  current.echo.stop();
  current.duck.release();
  current.duck.disconnect();
  current.microphone?.stop();
  // This file's to release, because this file opened them. Sessions are given
  // `ownsAudioResources: false` so neither can close them out from under the
  // meeting's passthrough on a dropped socket.
  current.tabStream.getTracks().forEach((track) => track.stop());
  await current.context.close().catch(() => undefined);
  reportStatus();
}

chrome.runtime.onMessage.addListener((message) => {
  const forOffscreen = forContext(message, 'offscreen');
  if (!forOffscreen) return;

  if (forOffscreen.type === 'begin') {
    begin(forOffscreen.streamId, forOffscreen.settings).catch((err: unknown) => {
      errors.inbound = err instanceof Error ? err.message : 'Could not start capture';
      void end().then(reportStatus);
    });
  } else {
    // A stop bumps the generation as well, so a start still waiting on the
    // microphone abandons the graph it is about to build.
    generation += 1;
    void end();
  }
});
