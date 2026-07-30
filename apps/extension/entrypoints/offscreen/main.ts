import {
  ConversationSession,
  TranslateSocket,
  translateSocketUrl,
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import type { ServerEvent } from '@chatofy/types';
import { DuckController } from '../../src/duck-controller';
import { EchoMonitor } from '../../src/echo-monitor';
import { openTabAudio } from '../../src/tab-audio-source';
import { forContext, type CaptureSettings, type TranscriptLine } from '../../src/messages';

/**
 * The audio graph, and the only place in the extension that translates anything.
 *
 * Everything below the message handling is `@chatofy/realtime-client`, unchanged
 * from what the web page uses. The turn-taking policy, the concurrency, the ordering
 * and the metrics all live there; this file supplies the browser APIs and the three
 * things that are genuinely specific to a captured tab — where the input comes from,
 * that the original has to be played back, and that a real microphone is still open
 * somewhere the extension does not control.
 *
 * The configuration is the interesting part, and it is the whole difference from the
 * web page:
 *
 *   fullDuplex   — safe here, unlike on a shared phone. Playback happens in this
 *                  document, outside the captured tab's graph, so translated audio
 *                  cannot be re-captured. The loop is gone structurally.
 *   continuous   — capture never stops, so a turn ending returns straight to
 *                  listening instead of waiting to be re-armed.
 *   maxUtterance — someone in a meeting will not leave a 500ms silence for tens of
 *                  seconds, so length is what has to end a turn.
 *   maxInFlight  — three, matching the server's own per-socket ceiling.
 */

const WORKLET_PATH = 'worklets/mic-capture-processor.js';

/** Length ceiling for one turn. Provisional; phase 8's measurements settle it. */
const MAX_UTTERANCE_MS = 8000;

/** Turns this client keeps open at the server. Matches its per-socket ceiling. */
const MAX_IN_FLIGHT = 3;

interface Live {
  session: ConversationSession;
  context: AudioContext;
  duck: DuckController;
  echo: EchoMonitor;
  tabStream: MediaStream;
}

let live: Live | null = null;
let transcript: TurnKeyedTranscript = initialTurnKeyedTranscript;
/**
 * Whether translated audio is sounding or waiting to sound.
 *
 * From `OrderedPlayback.isBusy` via `onPlaybackBusy`, which counts queued turns rather
 * than only samples currently playing. Ducking and the echo count both hang off this,
 * and both would be wrong keyed on "a sample is playing": with a growing backlog that
 * is permanently true, so the meeting would stay ducked for the whole call.
 */
let playbackBusy = false;

const send = (message: unknown) => {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
};

function reportStatus(capturing: boolean, error?: string): void {
  send({
    to: 'worker',
    type: 'status',
    status: {
      capturing,
      error,
      backlogTurns: Object.keys(transcript.live).length,
      echoEvents: live?.echo.echoEvents ?? 0,
    },
  });
}

/**
 * Push one turn's text to the overlay.
 *
 * Both the finished turns and the in-progress ones come from the turn-keyed reducer,
 * which is the whole reason it exists: the single-turn reducer keeps one live line
 * for a conversation and clears it whenever any turn ends, so with three turns in
 * flight it would flicker between sentences and wipe lines still being spoken.
 */
function publishTranscript(): void {
  const lines: TranscriptLine[] = [];
  for (const segment of transcript.turns.slice(-20)) {
    lines.push({
      sessionId: segment.sessionId,
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      final: true,
    });
  }
  for (const [sessionId, turn] of Object.entries(transcript.live)) {
    lines.push({
      sessionId,
      sourceText: turn.text,
      targetText: turn.translation,
      final: false,
    });
  }
  // One message for the whole set. A message per line meant ~100 IPC round-trips and
  // ~100 full overlay rebuilds per second with three turns emitting partials.
  send({ to: 'worker', type: 'transcript', lines });
}

async function begin(streamId: string, settings: CaptureSettings): Promise<void> {
  await end();
  transcript = initialTurnKeyedTranscript;
  playbackBusy = false;

  const context = new AudioContext();
  const workletUrl = chrome.runtime.getURL(WORKLET_PATH);

  // Held here so the catch below can release whatever was built before a failure.
  // `live` is only assigned on the last line of this function, so `end()` cannot see
  // a partial start — without these, a throw after `openTabAudio` would leak the tab
  // stream and the context with nothing left holding a reference to either.
  let tabStream: MediaStream | null = null;

  try {
    // Opened here rather than inside the session, because the session's
    // `openMicrophone` is what feeds the translator and this is the tab, not a
    // microphone. One context for all of it, and this file owns it: the session is
    // given `ownsAudioResources: false` precisely so it cannot close what the
    // meeting's own passthrough depends on.
    const tab = await openTabAudio(context, streamId);
    tabStream = tab.stream;

    // Created suspended when there was no user gesture. Left that way, `currentTime`
    // never advances, so nothing scheduled ever plays and no `onended` ever fires —
    // the meeting would be silent and every turn would eventually hit the stall
    // watchdog, which looks identical to a pipeline fault in the logs.
    if (context.state === 'suspended') await context.resume();

    await startGraph(context, tab, workletUrl, settings);
  } catch (err) {
    tabStream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    throw err;
  }
}

/** Build the audio graph and the session on an already-open tab stream. */
async function startGraph(
  context: AudioContext,
  tab: { stream: MediaStream; node: MediaStreamAudioSourceNode },
  workletUrl: string,
  settings: CaptureSettings,
): Promise<void> {
  const duck = new DuckController(context);
  // The captured tab is muted for the user by the act of capturing it, so this
  // connection is not a convenience: without it the meeting is silent.
  duck.connect(tab.node, context.destination);

  // A holder, because the echo monitor is built before the session and has to reach it
  // afterwards — the count has to land on the session's per-turn field, and the session
  // needs the monitor's `isPlaying` at construction. A plain `let` assigned once reads
  // as a `const` to the linter and cannot express the forward reference.
  const sessionRef: { current: ConversationSession | undefined } = { current: undefined };

  const echo = new EchoMonitor({
    context,
    workletUrl,
    // The playback state, not `duck.isDucked`: ducking has a release delay, so keying
    // the measurement on it would count room noise for a quarter second after every
    // turn as echo.
    isPlaying: () => playbackBusy,
    onEchoHeard: () => {
      // Routed through the session so it lands on the turn being captured and reaches
      // the metrics row. The pump's own echo gate is unreachable in continuous mode —
      // it only runs while capture is muted, and continuous mode never mutes — so this
      // microphone is the only source of the number here.
      sessionRef.current?.noteEchoHeard();
      reportStatus(true);
    },
  });

  const session = new ConversationSession(
    {
      // The translator's input is the TAB, not a microphone. Everything else about
      // the session is unchanged from the web page.
      openMicrophone: () => Promise.resolve(tab.stream),
      createAudioContext: () => context,
      createWorkletNode: (ctx) => new AudioWorkletNode(ctx, 'mic-capture-processor'),
      createSocket: (handlers) =>
        new TranslateSocket(translateSocketUrl(settings.apiBaseUrl), handlers),
      workletUrl,
      // This file owns the context and the tab stream, not the session. The session
      // tears itself down on a dropped socket, and closing the context there would
      // silence the meeting for good — `tabCapture` has already muted the tab, and
      // the graph replaying it lives in that same context.
      ownsAudioResources: false,
    },
    {
      onStatus: () => reportStatus(true),
      onLevel: () => {},
      onMuted: () => {},
      onError: (message) => reportStatus(true, message ?? undefined),
      onEchoHeard: () => {},
      // The whole ducking mechanism. `busy` counts queued turns, not sounding
      // samples, which is what stops the meeting being ducked for the entire call
      // once a backlog forms.
      onPlaybackBusy: (busy) => {
        playbackBusy = busy;
        duck.setBusy(busy);
      },
      onServerEvent: (event: ServerEvent) => {
        transcript = turnKeyedTranscriptReducer(transcript, event);
        publishTranscript();
      },
      onReset: () => {
        transcript = initialTurnKeyedTranscript;
      },
      onTurnAbandoned: (sessionId) => {
        // A turn refused at the ceiling or dropped at a backlog ceiling produces no
        // `server.session.ended`, so without this its live line would sit on the
        // overlay for the rest of the meeting.
        transcript = turnKeyedTranscriptReducer(transcript, {
          type: 'transcript.turnAbandoned',
          sessionId: sessionId ?? undefined,
        });
        publishTranscript();
      },
      // Dropped turns and forced releases are logged rather than swallowed. In a
      // meeting these are the events that explain a missing sentence.
      onLog: (message) => console.info(`[chatofy] ${message}`),
      // The session stops itself when the socket drops. Without this the microphone
      // and the tab stream would stay open with the popup still saying "capturing",
      // because nothing else here would ever learn the run had ended.
      onStopped: () => void end(),
    },
    () => ({
      fullDuplex: true,
      continuous: true,
      maxUtteranceMs: MAX_UTTERANCE_MS,
      maxInFlight: MAX_IN_FLIGHT,
      reportMetrics: settings.reportMetrics,
    }),
  );

  sessionRef.current = session;
  // Assigned before `start()`, so `onStopped` — which the session can fire from
  // inside `start()`'s own failure path — finds something to release.
  live = { session, context, duck, echo, tabStream: tab.stream };

  await session.start({
    direction: settings.direction,
    voiceGender: settings.voiceGender,
  });
  await echo.start();
  reportStatus(true);
}

async function end(): Promise<void> {
  const current = live;
  live = null;
  if (!current) return;

  current.echo.stop();
  current.duck.release();
  current.duck.disconnect();
  current.session.stop();
  // This file's to release, because this file opened them. The session is given
  // `ownsAudioResources: false` so it cannot close them out from under the meeting's
  // passthrough on a dropped socket.
  current.tabStream.getTracks().forEach((track) => track.stop());
  await current.context.close().catch(() => undefined);
  playbackBusy = false;
  reportStatus(false);
}

chrome.runtime.onMessage.addListener((message) => {
  const forOffscreen = forContext(message, 'offscreen');
  if (!forOffscreen) return;

  if (forOffscreen.type === 'begin') {
    begin(forOffscreen.streamId, forOffscreen.settings).catch((err: unknown) => {
      reportStatus(false, err instanceof Error ? err.message : 'Could not start capture');
      void end();
    });
  } else {
    void end();
  }
});
