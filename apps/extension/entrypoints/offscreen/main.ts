import { createDirectionSession } from '../../src/direction-session';
import { EchoMonitor } from '../../src/echo-monitor';
import { MeetingCapture } from '../../src/meeting-capture';
import { openGatedMicrophone } from '../../src/outbound-mic';
import { openTabAudio } from '../../src/tab-audio-source';
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
  workletUrl: chrome.runtime.getURL(WORKLET_PATH),
  onStatus: (status) => send({ to: 'worker', type: 'status', status }),
  onTranscript: (lines) => send({ to: 'worker', type: 'transcript', lines }),
});

chrome.runtime.onMessage.addListener((message) => {
  const forOffscreen = forContext(message, 'offscreen');
  if (!forOffscreen) return;

  if (forOffscreen.type === 'begin') {
    capture.begin(forOffscreen.streamId, forOffscreen.settings).catch((err: unknown) => {
      capture.noteStartFailure(err instanceof Error ? err.message : 'Could not start capture');
      void capture.end().then(() => capture.reportStatus());
    });
  } else {
    void capture.stop();
  }
});
