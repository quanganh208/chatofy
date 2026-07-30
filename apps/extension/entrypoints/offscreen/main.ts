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
  for (const turn of lines) send({ to: 'worker', type: 'transcript', turn });
}

async function begin(streamId: string, settings: CaptureSettings): Promise<void> {
  await end();
  transcript = initialTurnKeyedTranscript;

  const context = new AudioContext();
  const workletUrl = chrome.runtime.getURL(WORKLET_PATH);

  // Opened here rather than inside the session, because the session's
  // `openMicrophone` is what feeds the translator and this is the tab, not a
  // microphone. The same context is used for all of it — the session closes that
  // context on teardown, and a duck node or echo microphone living in a different
  // one would outlive the thing it belongs to.
  const tab = await openTabAudio(context, streamId);

  const duck = new DuckController(context);
  // The captured tab is muted for the user by the act of capturing it, so this
  // connection is not a convenience: without it the meeting is silent.
  duck.connect(tab.node, context.destination);

  const echo = new EchoMonitor({
    context,
    workletUrl,
    isPlaying: () => duck.isDucked,
    onEchoHeard: () => reportStatus(true),
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
    },
    {
      onStatus: () => reportStatus(true),
      onLevel: () => {},
      onMuted: () => {},
      onError: (message) => reportStatus(true, message ?? undefined),
      onEchoHeard: () => {},
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
    },
    () => ({
      fullDuplex: true,
      continuous: true,
      maxUtteranceMs: MAX_UTTERANCE_MS,
      maxInFlight: MAX_IN_FLIGHT,
      reportMetrics: settings.reportMetrics,
    }),
  );

  await session.start({
    direction: settings.direction,
    voiceGender: settings.voiceGender,
  });
  await echo.start();

  live = { session, context, duck, echo, tabStream: tab.stream };
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
  // The session closes the context it was given; the tab stream is this file's to
  // release, since this file opened it.
  current.tabStream.getTracks().forEach((track) => track.stop());
  await current.context.close().catch(() => undefined);
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
