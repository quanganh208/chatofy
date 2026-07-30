import {
  forContext,
  type CaptureStatus,
  type OverlayState,
  type TranscriptLine,
} from '../src/messages';
import { loadSettings } from '../src/settings';

/**
 * The service worker: mints the capture stream id, owns the offscreen document, and
 * relays state to the overlay.
 *
 * It is split this way because MV3 leaves no choice about any of it. Only an
 * extension context can call `tabCapture.getMediaStreamId`, and only a document can
 * hold an `AudioContext` — a service worker cannot, and is killed when idle
 * regardless. So the id is minted here and the audio graph lives in the offscreen
 * document, with this worker as the only thing that can create one.
 *
 * No state is kept in module scope beyond what is cheap to rebuild. The worker is
 * terminated whenever Chrome feels like it, and anything important is either in the
 * offscreen document, which stays alive while it holds audio, or in
 * `chrome.storage`.
 */

/** Chrome permits exactly one offscreen document per extension. */
const OFFSCREEN_PATH = 'offscreen.html';

/** Last state pushed to the overlay, so a content script that loads late can catch up. */
let overlay: OverlayState = { capturing: false, lines: [] };
let activeTabId: number | null = null;

async function hasOffscreen(): Promise<boolean> {
  // `getContexts` is the only reliable answer. Creating one unconditionally throws
  // when it already exists, and catching that error is indistinguishable from a real
  // failure to create it.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    // Both, and both are needed. USER_MEDIA covers the captured tab stream and the
    // echo microphone; AUDIO_PLAYBACK covers playing the original back and speaking
    // the translation.
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Captures the meeting tab, plays the original back, and speaks the translation.',
  });
}

async function startCapture(tabId: number): Promise<void> {
  // The previous meeting's transcript must not appear in this one's overlay. Without
  // this, capturing meeting A, stopping, and capturing meeting B in another tab renders
  // A's lines in B's overlay — and `query` hands them to B's popup too.
  overlay = { capturing: false, lines: [] };

  // Tell the tab we are leaving that it is no longer being captured, before
  // `activeTabId` moves. Otherwise its overlay keeps showing the recording indicator
  // for a capture that has moved elsewhere.
  if (activeTabId !== null && activeTabId !== tabId) {
    void chrome.tabs
      .sendMessage(activeTabId, {
        to: 'content',
        type: 'render',
        state: { capturing: false, lines: [] },
      })
      .catch(() => undefined);
  }

  await ensureOffscreen();

  // Single-use and short-lived, so it is minted immediately before being consumed.
  // It also requires the extension to have been invoked on this tab, which is what
  // `activeTab` grants and host permissions alone do not.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const settings = await loadSettings();

  activeTabId = tabId;
  await chrome.runtime.sendMessage({
    to: 'offscreen',
    type: 'begin',
    streamId,
    tabId,
    settings,
  });
}

async function stopCapture(): Promise<void> {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ to: 'offscreen', type: 'end' });
    // Closed rather than left idle: while it exists it holds the microphone
    // permission indicator, and a document that is not capturing anything showing a
    // recording indicator is worse than no indicator at all.
    await chrome.offscreen.closeDocument();
  }
  publish({ capturing: false, lines: overlay.lines });
}

/** Push overlay state to the captured tab, if its content script is there. */
function publish(state: OverlayState): void {
  overlay = state;
  if (activeTabId === null) return;
  void chrome.tabs
    .sendMessage(activeTabId, { to: 'content', type: 'render', state })
    // A tab that navigated away, or one on a page the content script does not match,
    // has no listener. That is normal and not worth reporting.
    .catch(() => undefined);
}

function applyStatus(status: CaptureStatus): void {
  publish({
    capturing: status.capturing,
    lines: overlay.lines,
    error: status.error,
  });
}

/** Newest lines last, bounded — the overlay is a window, not a transcript archive. */
const MAX_OVERLAY_LINES = 40;

function applyTranscript(lines: TranscriptLine[]): void {
  publish({
    capturing: overlay.capturing,
    error: overlay.error,
    lines: lines.slice(-MAX_OVERLAY_LINES),
  });
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const forWorker = forContext(message, 'worker');
    if (!forWorker) return undefined;

    switch (forWorker.type) {
      case 'start':
        // Errors are reported through the same channel as everything else rather
        // than rejected at the caller: the popup may already be closed by the time
        // capture fails, and a rejected promise nobody is holding is a silent
        // failure.
        startCapture(forWorker.tabId).catch((err: unknown) => {
          publish({
            capturing: false,
            lines: overlay.lines,
            error: err instanceof Error ? err.message : 'Could not capture this tab',
          });
        });
        return undefined;

      case 'stop':
        void stopCapture();
        return undefined;

      case 'query':
        sendResponse(overlay);
        // `true` keeps the message channel open for the response above.
        return true;

      case 'status':
        applyStatus(forWorker.status);
        return undefined;

      case 'transcript':
        applyTranscript(forWorker.lines);
        return undefined;

      default:
        return undefined;
    }
  });

  // A tab that closes or navigates takes the capture with it. Without this the
  // offscreen document would keep a dead stream open and the overlay would claim to
  // be capturing a tab that no longer exists.
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) void stopCapture();
  });
});
