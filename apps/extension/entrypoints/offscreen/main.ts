import { createDirectionSession } from '../../src/direction-session';
import { EchoMonitor } from '../../src/echo-monitor';
import { getFreshAccessToken } from '../../src/access-token';
import { MeetingCapture } from '../../src/meeting-capture';
import { openGatedMicrophone } from '../../src/outbound-mic';
import { PagePlaybackSink } from '../../src/page-playback-sink';
import { loadSettings } from '../../src/settings';
import { openTabAudio } from '../../src/tab-audio-source';
import { VoiceHold } from '../../src/outbound-voice-lease';
import { forContext } from '../../src/messages';

/**
 * The offscreen document: the browser half of the audio graph.
 *
 * Chrome APIs, Web Audio globals and `chrome.runtime` messaging, and nothing
 * else. Which thing is opened when, what a failure costs, and what a teardown
 * releases all live in {@link MeetingCapture} — those are ordering decisions, and
 * ordering was wrong three separate ways while they were tangled up with the
 * browser here where no test could reach them.
 */

const WORKLET_PATH = 'worklets/mic-capture-processor.js';

const send = (message: unknown) => {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
};

const capture = new MeetingCapture({
  createContext: () => new AudioContext(),
  openTab: openTabAudio,
  openMicrophone: openGatedMicrophone,
  createEcho: (deps) => new EchoMonitor(deps),
  createSession: createDirectionSession,
  // The relay into the meeting page. This document may only use
  // `chrome.runtime`, so every frame goes offscreen → worker → tab → page.
  createPageSink: (onTurnDrained) =>
    new PagePlaybackSink({
      send: (command) => send({ to: 'worker', type: 'outbound.command', command }),
      onTurnDrained,
    }),
  // Same relay, different lifetime: this one is held for the whole session and
  // renewed, so a document that dies gives the user their microphone back.
  holdOutboundVoice: new VoiceHold({
    send: (mine) =>
      send({ to: 'worker', type: 'outbound.command', command: { type: 'chatofy:voice', mine } }),
  }),
  // Read per capture, not held: the popup can sign out between meetings.
  //
  // Renewed as well as read. An access token lives fifteen minutes now, and an
  // extension sits idle between meetings for far longer — the stale one would be
  // refused at the socket's HTTP upgrade, before a socket exists to carry a
  // reason, leaving the user a connection error with nothing to act on.
  // `apiBaseUrl` is decided at build time and read back here rather than taken
  // from the capture's settings, because this dependency is asked for a token
  // and nothing else.
  loadAccessToken: async () => getFreshAccessToken((await loadSettings()).apiBaseUrl),
  workletUrl: chrome.runtime.getURL(WORKLET_PATH),
  onStatus: (status) => send({ to: 'worker', type: 'status', status }),
  onTranscript: (lines) => send({ to: 'worker', type: 'transcript', lines }),
});

chrome.runtime.onMessage.addListener((message) => {
  const forOffscreen = forContext(message, 'offscreen');
  if (!forOffscreen) return;

  if (forOffscreen.type === 'begin') {
    capture
      .begin(forOffscreen.streamId, forOffscreen.settings, forOffscreen.patched)
      .catch((err: unknown) => {
        capture.noteStartFailure(err instanceof Error ? err.message : 'Could not start capture');
        void capture.end().then(() => capture.reportStatus());
      });
    return;
  }

  if (forOffscreen.type === 'outbound.transmitting') {
    capture.setTransmitting(forOffscreen.transmitting);
    return;
  }

  if (forOffscreen.type === 'status.query') {
    capture.reportStatus();
    return;
  }

  // Named, not a fall-through. Every unrecognised message used to mean "stop",
  // which made adding any new message to this context a way to silently end a
  // live capture — the kind of trap that is only found once.
  if (forOffscreen.type === 'end') {
    void capture.stop();
  }
});
