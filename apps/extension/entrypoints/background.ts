import {
  forContext,
  type CaptureStatus,
  type OverlayState,
  type TranscriptLine,
} from '../src/messages';
import { loadSettings, saveSettings } from '../src/settings';
import { MEETING_URL_PATTERNS, supportOf } from '../src/supported-meeting-url';

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
let overlay: OverlayState = { capturing: false, lines: [], outbound: 'off', errors: {} };
let activeTabId: number | null = null;

/** The keyboard shortcut that toggles capture, and the menu item that does the same. */
const TOGGLE_COMMAND = 'toggle-capture';
const TOGGLE_MENU_ID = 'chatofy-toggle-capture';

/**
 * The page-world patch, registered only while the outbound direction is on.
 *
 * Not in the manifest, deliberately — see `entrypoints/inject.content/index.ts`.
 * WXT builds it under `content-scripts/`; `registration: 'runtime'` keeps it out
 * of the manifest and still emits the file. The id is ours to choose and has to
 * survive worker restarts, because registrations persist and re-registering an
 * existing id throws.
 */
const PATCH_SCRIPT_ID = 'chatofy-microphone-patch';

const OUTBOUND_SCRIPTS: chrome.scripting.RegisteredContentScript[] = [
  {
    id: PATCH_SCRIPT_ID,
    js: ['content-scripts/inject.js'],
    matches: [...MEETING_URL_PATTERNS],
    world: 'MAIN',
    // Before the page's own code can call `getUserMedia`.
    runAt: 'document_start',
    persistAcrossSessions: true,
  },
];

/** Tabs whose page world carries the patch. Cleared when they navigate. */
const patchedTabs = new Set<number>();

/**
 * Ask Chrome, not the page, whether a tab carries the patch.
 *
 * The earlier design had the page world report in over a `MessagePort` handed
 * across `window` at `document_start`, on the reasoning that no page script had
 * run yet. The end-to-end harness disproved it — a script in the page's `<head>`
 * both sees that message and receives the port — so any claim arriving that way
 * is forgeable, and a forged "patched" would have the overlay telling the user
 * their speech was reaching the meeting while it went nowhere.
 *
 * `executeScript` returns through Chrome. The page can still lie about the
 * property being present, but it gains nothing by it: the answer only decides
 * what the overlay says, and a page that wanted the user misinformed could
 * simply not run the patch.
 */
async function probePatched(tabId: number): Promise<boolean> {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => Object.prototype.hasOwnProperty.call(navigator.mediaDevices, 'getUserMedia'),
    });
    return probe?.result === true;
  } catch {
    // A tab that navigated away, or one outside the host permissions. Neither is
    // patched, and neither is worth reporting as a failure.
    return false;
  }
}

/** Re-ask, and republish if the answer changed for the tab being captured. */
async function refreshPatched(tabId: number): Promise<void> {
  const patched = await probePatched(tabId);
  const had = patchedTabs.has(tabId);
  if (patched) patchedTabs.add(tabId);
  else patchedTabs.delete(tabId);
  if (patched !== had) {
    await rememberPatchedTabs();
    if (tabId === activeTabId) publish(overlay);
  }
}

/**
 * Remembered across worker restarts, because Chrome ends this worker whenever it
 * likes and the alternative is telling the user to reload a page that is already
 * patched — an instruction that costs them the `activeTab` grant and therefore
 * their capture.
 */
const PATCHED_TABS_KEY = 'chatofy.patchedTabs';

async function rememberPatchedTabs(): Promise<void> {
  await chrome.storage.session.set({ [PATCHED_TABS_KEY]: [...patchedTabs] });
}

async function restorePatchedTabs(): Promise<void> {
  const stored = await chrome.storage.session.get(PATCHED_TABS_KEY);
  const tabs = stored[PATCHED_TABS_KEY];
  if (!Array.isArray(tabs)) return;
  for (const tabId of tabs) if (typeof tabId === 'number') patchedTabs.add(tabId);
}

/**
 * Serialises {@link syncPatchRegistration}.
 *
 * It is driven from three places — worker start, every storage change, and the
 * settings handler, which itself writes storage — so two runs overlap routinely.
 * Both would read "nothing registered" and both would call register, and the
 * second throws `Duplicate script ID`. Chaining is enough; there is no ordering
 * requirement beyond "one at a time, last write wins".
 */
let registrationQueue: Promise<void> = Promise.resolve();

function syncPatchRegistration(outbound: boolean): Promise<void> {
  registrationQueue = registrationQueue.then(() => applyRegistration(outbound));
  return registrationQueue;
}

/**
 * Register or remove the outbound scripts to match the setting.
 *
 * Reads the current registration rather than tracking it, because Chrome
 * persists these across worker restarts: on a fresh worker the work may already
 * be done. Registering an id that exists throws, and so does unregistering one
 * that does not.
 */
async function applyRegistration(outbound: boolean): Promise<void> {
  const ids = OUTBOUND_SCRIPTS.map((script) => script.id);
  // Deliberately not caught. "Could not find out" is a different state from
  // "nothing is registered", and treating them alike takes the register branch
  // and throws a duplicate id — a failure that would then be reported as though
  // the page could not be patched.
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
  const present = new Set(existing.map((script) => script.id));

  if (!outbound) {
    const registered = ids.filter((id) => present.has(id));
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: registered });
    }
    return;
  }

  const missing = OUTBOUND_SCRIPTS.filter((script) => !present.has(script.id));
  if (missing.length > 0) await chrome.scripting.registerContentScripts(missing);
}

/**
 * The shortcut Chrome actually assigned, or `undefined` when it assigned none.
 *
 * Read once and passed to the overlay, which is the only surface that can tell
 * someone in a toolbar-less call window how to start. Printing the suggested key
 * instead would be a lie whenever it collided with something else or the user
 * rebound it at chrome://extensions/shortcuts.
 */
let shortcutHint: string | undefined;

/** What the overlay's selects should show, refreshed whenever storage changes. */
let settingsHint: OverlayState['settings'];

async function refreshSettingsHint(): Promise<void> {
  const { direction, voiceGender, outbound } = await loadSettings();
  settingsHint = { direction, voiceGender, outbound };
  try {
    await syncPatchRegistration(outbound);
  } catch (err) {
    // Reported, not swallowed. Silence here means the setting says on, no page
    // ever gets patched, and the only thing the user is ever told is to reload —
    // which cannot help and costs them their capture.
    publish({
      ...overlay,
      errors: {
        ...overlay.errors,
        outbound: `Could not prepare this page for your microphone: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      },
    });
  }
}

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
  overlay = { capturing: false, lines: [], outbound: 'off', errors: {} };

  // Tell the tab we are leaving that it is no longer being captured, before
  // `activeTabId` moves. Otherwise its overlay keeps showing the recording indicator
  // for a capture that has moved elsewhere.
  if (activeTabId !== null && activeTabId !== tabId) {
    void chrome.tabs
      .sendMessage(activeTabId, {
        to: 'content',
        type: 'render',
        state: { capturing: false, lines: [], outbound: 'off', errors: {} },
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
  // Asked here rather than assumed, so the overlay's first render tells the
  // truth about whether this page can carry the user's translated voice.
  if (settings.outbound) await refreshPatched(tabId);

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
  publish({ capturing: false, lines: overlay.lines, outbound: 'off', errors: {} });
}

/**
 * Start capturing this tab, or stop if it is already the one being captured.
 *
 * The single entry point behind every way of invoking the extension: the keyboard
 * shortcut, the context menu, and the overlay's own button. They differ only in
 * how Chrome hands over the tab.
 */
async function toggleCaptureFor(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return;

  if (overlay.capturing && activeTabId === tabId) {
    await stopCapture();
    return;
  }

  const support = supportOf(tab?.url);
  if (!support.ok) {
    // Sent straight to the tab rather than through `publish`, which only ever
    // addresses the captured one. On a page outside the match patterns there is no
    // content script listening and nothing happens, which is the right outcome:
    // the shortcut is global, and a page with no overlay has nowhere to complain.
    void chrome.tabs
      .sendMessage(tabId, {
        to: 'content',
        type: 'render',
        state: {
          capturing: false,
          lines: [],
          outbound: 'off',
          errors: { capture: support.message },
          shortcut: shortcutHint,
        },
      })
      .catch(() => undefined);
    return;
  }

  // Capture already running on another tab: `startCapture` clears that tab's
  // overlay before taking this one, so a plain start is the whole move.
  await startCapture(tabId);
}

/** Report a failed toggle the same way a failed start is reported. */
function reportToggleFailure(err: unknown): void {
  publish({
    capturing: false,
    lines: overlay.lines,
    outbound: 'off',
    errors: { capture: err instanceof Error ? err.message : 'Could not capture this tab' },
  });
}

/**
 * Name the context menu item after what a click on it will actually do.
 *
 * Chrome has no per-tab menu title and no "about to be shown" event outside Firefox,
 * so the title is recomputed against the tab the user is looking at — on every state
 * change, and whenever the focused tab or window changes. The comparison is against
 * the CAPTURED tab, not merely `capturing`: with a meeting running in one tab, the
 * item on a second meeting tab starts that one, and "stop" there would name the
 * wrong action.
 */
async function refreshMenuTitle(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const stops = overlay.capturing && activeTabId !== null && tab?.id === activeTabId;
  await chrome.contextMenus.update(TOGGLE_MENU_ID, {
    title: stops ? 'Chatofy: stop translating' : 'Chatofy: start translating',
  });
}

/** Push overlay state to the captured tab, if its content script is there. */
function publish(state: OverlayState): void {
  // The shortcut rides along on every push. The overlay is the only place that can
  // tell someone in a toolbar-less window how to start, and it has no way to ask
  // Chrome itself — `chrome.commands` is not exposed to content scripts.
  overlay = {
    ...state,
    shortcut: shortcutHint,
    settings: settingsHint,
    patched: activeTabId !== null ? patchedTabs.has(activeTabId) : undefined,
  };
  // Before the early return below: a state change still renames the menu item even
  // when there is no tab to push the render to.
  // The item does not exist until `onInstalled` has run once, and updating a missing
  // one rejects — harmless, and not worth reporting.
  void refreshMenuTitle().catch(() => undefined);
  if (activeTabId === null) return;
  void chrome.tabs
    .sendMessage(activeTabId, { to: 'content', type: 'render', state: overlay })
    // A tab that navigated away, or one on a page the content script does not match,
    // has no listener. That is normal and not worth reporting.
    .catch(() => undefined);
}

function applyStatus(status: CaptureStatus): void {
  publish({
    capturing: status.capturing,
    lines: overlay.lines,
    outbound: status.outbound,
    // The offscreen document owns both direction errors and reports them
    // together, so they replace their own slots wholesale; `capture` is this
    // worker's and survives untouched.
    errors: { capture: overlay.errors.capture, ...status.errors },
  });
}

/** Newest lines last, bounded — the overlay is a window, not a transcript archive. */
const MAX_OVERLAY_LINES = 40;

function applyTranscript(lines: TranscriptLine[]): void {
  publish({
    capturing: overlay.capturing,
    outbound: overlay.outbound,
    errors: overlay.errors,
    lines: lines.slice(-MAX_OVERLAY_LINES),
  });
}

export default defineBackground(() => {
  // Read early and kept in module scope: the worker is restarted constantly and
  // this is one `getAll` per restart, not per push.
  void chrome.commands
    .getAll()
    .then((commands) => {
      shortcutHint = commands.find((c) => c.name === TOGGLE_COMMAND)?.shortcut || undefined;
    })
    .catch(() => undefined);

  // Restored first: the registration sync below publishes, and publishing before
  // the patched tabs are back would tell whoever is mid-meeting to reload.
  void restorePatchedTabs()
    .then(() => refreshSettingsHint())
    .catch(() => undefined);

  // The popup writes the same two values this overlay shows. Without this, changing
  // the direction there would leave a running overlay showing the old one.
  chrome.storage.onChanged.addListener(() => {
    void refreshSettingsHint()
      .then(() => publish(overlay))
      .catch(() => undefined);
  });

  // Created here rather than on every worker start: Chrome persists menu items, and
  // creating one that already exists fails with a duplicate id.
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: TOGGLE_MENU_ID,
        // Nothing is being captured at install time; `refreshMenuTitle` owns it
        // from here on.
        title: 'Chatofy: start translating',
        // Not `['page']`. A call window is almost entirely video, and a right-click
        // on a video element is not a page context — the item would be missing
        // exactly where it is the only way in.
        contexts: ['all'],
        documentUrlPatterns: [...MEETING_URL_PATTERNS],
      });
    });
  });

  // Switching tab or window changes which tab the menu item would act on, and the
  // worker is restarted often enough that the title has to be rebuilt on start too.
  void refreshMenuTitle().catch(() => undefined);
  chrome.tabs.onActivated.addListener(() => {
    void refreshMenuTitle().catch(() => undefined);
  });
  chrome.windows.onFocusChanged.addListener(() => {
    void refreshMenuTitle().catch(() => undefined);
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== TOGGLE_COMMAND) return;
    void (async () => {
      // Chrome usually supplies the tab. When it does not, the focused window's
      // active tab is the one the person just pressed the key in.
      const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      await toggleCaptureFor(target);
    })().catch(reportToggleFailure);
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== TOGGLE_MENU_ID) return;
    toggleCaptureFor(tab).catch(reportToggleFailure);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
            outbound: 'off',
            errors: {
              capture: err instanceof Error ? err.message : 'Could not capture this tab',
            },
          });
        });
        return undefined;

      case 'stop':
        void stopCapture();
        return undefined;

      case 'settings':
        void (async () => {
          const current = await loadSettings();
          await saveSettings({
            ...current,
            direction: forWorker.direction,
            voiceGender: forWorker.voiceGender,
            outbound: forWorker.outbound,
          });
          await refreshSettingsHint();

          // Reopened rather than patched in place: the offscreen document is handed
          // its settings once, when capture opens, and this keeps a single path that
          // opens one. The activeTab grant survives a stop, so re-minting the stream
          // id needs no new invocation.
          if (overlay.capturing && activeTabId !== null) {
            const tabId = activeTabId;
            await stopCapture();
            await startCapture(tabId);
          } else {
            publish(overlay);
          }
        })().catch(reportToggleFailure);
        return undefined;

      case 'toggle':
        // From the overlay's own button. The tab comes from the sender rather than
        // the message: a content script has no way to learn its own tab id, and one
        // it claimed could not be trusted anyway.
        toggleCaptureFor(sender.tab).catch(reportToggleFailure);
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
    patchedTabs.delete(tabId);
    void rememberPatchedTabs();
    if (tabId === activeTabId) void stopCapture();
  });

  // A tab that navigates or reloads throws its document away, and with it the
  // page-world patch. `onRemoved` does not fire for that — it only fires on
  // close — so without this a reloaded meeting would stay marked as patched and
  // the overlay would keep claiming the user's speech was reaching it.
  //
  // A tab that navigates or reloads throws its document away, and with it the
  // patch. `onRemoved` does not fire for that — it only fires on close.
  //
  // Unfiltered, because `chrome.tabs.onUpdated` takes no filter; that is a
  // `webNavigation` feature, and buying it would mean asking for a permission to
  // avoid a cheap early return.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && patchedTabs.has(tabId)) {
      patchedTabs.delete(tabId);
      void rememberPatchedTabs();
      if (tabId === activeTabId) publish(overlay);
      return;
    }
    // Loaded: ask whether the new document got the patch. This is also what
    // recovers the answer after a service-worker restart, since the page has no
    // way to volunteer it.
    if (changeInfo.status === 'complete') void refreshPatched(tabId);
  });
});
