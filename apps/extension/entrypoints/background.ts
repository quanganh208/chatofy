import type { MeetingMinutes } from '@chatofy/types';
import { clearAccessToken, loadAccessToken } from '../src/access-token';
import { forContext, type OverlayState } from '../src/messages';
import { MicrophonePatchRegistry, type PatchScript } from '../src/microphone-patch-registry';
import { overlayLinesToMinutesSource } from '../src/minutes-source';
import { OffscreenHost } from '../src/offscreen-host';
import { OverlayPublisher } from '../src/overlay-publisher';
import { loadSettings, saveSettings } from '../src/settings';
import {
  DEFAULT_SITE_ENABLEMENT,
  loadSiteEnablement,
  runsOn,
  watchSiteEnablement,
  type SiteEnablement,
} from '../src/site-enablement';
import {
  MEETING_URL_PATTERNS,
  enabledMeetingPatterns,
  meetingSiteOf,
  supportOf,
} from '../src/supported-meeting-url';

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
 * The state that has rules attached lives in `../src/` — the overlay's contents,
 * the offscreen document's lifecycle, and the microphone patch — because
 * `entrypoints/` is not covered by the unit suite and those rules are exactly the
 * ones that fail silently. This file is the wiring: it supplies the real Chrome
 * APIs and decides the order things happen in.
 *
 * No state is kept in module scope beyond what is cheap to rebuild. The worker is
 * terminated whenever Chrome feels like it, and anything important is either in the
 * offscreen document, which stays alive while it holds audio, or in
 * `chrome.storage`.
 */

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

const OUTBOUND_SCRIPTS: PatchScript[] = [
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

/**
 * Remembered across worker restarts, because Chrome ends this worker whenever it
 * likes and the alternative is telling the user to reload a page that is already
 * patched — an instruction that costs them the `activeTab` grant and therefore
 * their capture.
 */
const PATCHED_TABS_KEY = 'chatofy.patchedTabs';

/**
 * The tab being captured, remembered the same way and for a harder reason.
 *
 * Every frame of the user's translated speech is relayed through this worker to
 * that tab. Chrome ends the worker after ~30s idle, which two people listening to
 * each other reach constantly, and a restarted worker with no `activeTabId` drops
 * every frame from then on — silently, with the overlay still reporting the
 * translation as reaching the meeting.
 */
const ACTIVE_TAB_KEY = 'chatofy.activeTabId';

/**
 * The id this capture's minutes are stored under.
 *
 * The minutes endpoint is owner-scoped and keeps no transcript, so this only has
 * to be a stable key for the life of one meeting — a fresh one is minted per
 * capture. Persisted like the active tab so a Generate pressed after a
 * worker restart still names the same session rather than a new one.
 */
const SESSION_ID_KEY = 'chatofy.captureSessionId';

/** The two speaker labels the extension has: it knows sides, not a roster. */
const MINUTES_LABELS = { them: 'Participant', me: 'You' } as const;

/** Shown when a token is missing or refused — the popup is the only way to fix it. */
const MINUTES_SIGN_IN_MESSAGE = 'Sign in through the Chatofy popup to generate minutes.';

/**
 * How long a `query` waits for the offscreen document to say what it is doing.
 *
 * Only ever spent right after a worker restart. Long enough for one runtime
 * round trip, short enough that a document which never answers does not leave a
 * meeting page with no overlay at all.
 */
const QUERY_ANSWER_TIMEOUT_MS = 2000;

let activeTabId: number | null = null;

/** The current capture's minutes id, minted at start and restored on restart. */
let captureSessionId: string | null = null;

/**
 * Which platforms Chatofy is allowed to act on.
 *
 * Held in module scope and refreshed from storage on every worker start, because
 * `toggleCaptureFor` is reached from a keyboard shortcut and cannot afford to be
 * async before it decides. It starts permissive: a worker that has not finished
 * reading yet behaves as it did before the preference existed, which is a capture
 * the user asked for going ahead rather than being dropped without explanation.
 */
let enablement: SiteEnablement = DEFAULT_SITE_ENABLEMENT;

const patch = new MicrophonePatchRegistry(
  {
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
    probe: async (tabId) => {
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
    },
    // Deliberately not caught. "Could not find out" is a different state from
    // "nothing is registered", and treating them alike takes the register branch
    // and throws a duplicate id — a failure that would then be reported as though
    // the page could not be patched.
    getRegistered: (ids) => chrome.scripting.getRegisteredContentScripts({ ids }),
    register: (scripts) =>
      chrome.scripting.registerContentScripts(
        scripts as unknown as chrome.scripting.RegisteredContentScript[],
      ),
    unregister: (ids) => chrome.scripting.unregisterContentScripts({ ids }),
    persist: (tabIds) => chrome.storage.session.set({ [PATCHED_TABS_KEY]: tabIds }),
    restore: async () => {
      const stored = await chrome.storage.session.get([PATCHED_TABS_KEY]);
      const tabs = stored[PATCHED_TABS_KEY];
      return Array.isArray(tabs) ? (tabs as number[]) : [];
    },
  },
  OUTBOUND_SCRIPTS,
);

const offscreen = new OffscreenHost({
  hasDocument: async () => {
    // `getContexts` is the only reliable answer. Creating one unconditionally throws
    // when it already exists, and catching that error is indistinguishable from a real
    // failure to create it.
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts.length > 0;
  },
  createDocument: (url) =>
    chrome.offscreen.createDocument({
      url,
      // Both, and both are needed. USER_MEDIA covers the captured tab stream and the
      // echo microphone; AUDIO_PLAYBACK covers playing the original back and speaking
      // the translation.
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification:
        'Captures the meeting tab, plays the original back, and speaks the translation.',
    }),
  closeDocument: () => chrome.offscreen.closeDocument(),
  send: async (message) => {
    await chrome.runtime.sendMessage(message);
  },
});

const publisher = new OverlayPublisher({
  render: (tabId, state) => {
    void chrome.tabs
      .sendMessage(tabId, { to: 'content', type: 'render', state })
      // A tab that navigated away, or one on a page the content script does not match,
      // has no listener. That is normal and not worth reporting.
      .catch(() => undefined);
  },
  // The item does not exist until `onInstalled` has run once, and updating a missing
  // one rejects — harmless, and not worth reporting.
  refreshMenuTitle: () => void refreshMenuTitle().catch(() => undefined),
  patchedFor: (tabId) => (tabId === null ? undefined : patch.has(tabId)),
});

/** Send a render straight to one tab, bypassing the published state. */
function renderTo(tabId: number, state: OverlayState): void {
  void chrome.tabs
    .sendMessage(tabId, { to: 'content', type: 'render', state })
    .catch(() => undefined);
}

/** Re-ask whether a tab carries the patch, and republish if the answer moved. */
async function refreshPatched(tabId: number): Promise<void> {
  if ((await patch.refresh(tabId)) && tabId === activeTabId) publisher.republish();
}

function setActiveTab(tabId: number | null): void {
  activeTabId = tabId;
  publisher.setTarget(tabId);
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
  publisher.setSettings(settingsHint);
  try {
    await patch.sync(outbound);
  } catch (err) {
    // Reported, not swallowed. Silence here means the setting says on, no page
    // ever gets patched, and the only thing the user is ever told is to reload —
    // which cannot help and costs them their capture.
    publisher.publishError(
      'outbound',
      `Could not prepare this page for your microphone: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
  }
}

async function startCapture(tabId: number): Promise<void> {
  // The gate that makes "off on this platform" mean something, and it is HERE
  // rather than only in `toggleCaptureFor` because this is the choke point every
  // route reaches. The popup's Start message calls this directly, and so does the
  // settings handler when it reopens a running capture — a check upstream would
  // have left both able to record on a platform the user had switched off.
  if (!(await runsOnTab(tabId))) return;

  // The previous meeting's transcript must not appear in this one's overlay. Without
  // this, capturing meeting A, stopping, and capturing meeting B in another tab renders
  // A's lines in B's overlay — and `query` hands them to B's popup too.
  publisher.reset();

  // Tell the tab we are leaving that it is no longer being captured, before
  // `activeTabId` moves. Otherwise its overlay keeps showing the recording indicator
  // for a capture that has moved elsewhere.
  if (activeTabId !== null && activeTabId !== tabId) {
    renderTo(activeTabId, OverlayPublisher.blank());
  }

  await offscreen.ensure();

  // Single-use and short-lived, so it is minted immediately before being consumed.
  // It also requires the extension to have been invoked on this tab, which is what
  // `activeTab` grants and host permissions alone do not.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const settings = await loadSettings();

  setActiveTab(tabId);
  // Awaited, not fired off. This is the only record of which tab is being
  // captured that survives the worker, and the worker can be killed between here
  // and the `begin` below — leaving a capture running that the next worker has no
  // render target for, so its recording indicator would have nowhere to go.
  await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
  // A fresh minutes id per capture, persisted alongside the active tab so a
  // Generate after a worker restart still posts under the same session. Minted
  // after `publisher.reset()` above cleared the previous meeting's minutes.
  captureSessionId = crypto.randomUUID();
  await chrome.storage.session.set({ [SESSION_ID_KEY]: captureSessionId });
  // Asked here rather than assumed, so the overlay's first render tells the
  // truth about whether this page can carry the user's translated voice.
  if (settings.outbound) await refreshPatched(tabId);

  await chrome.runtime.sendMessage({
    to: 'offscreen',
    type: 'begin',
    streamId,
    tabId,
    settings,
    patched: patch.has(tabId),
  });
}

async function stopCapture(): Promise<void> {
  await offscreen.endCapture();
  // A stop this worker performed is authoritative — there is nothing left to ask
  // and nothing left to wait for. Without this, a status that never arrived would
  // leave the guess in place and suppress the very publish that takes the
  // indicator down, leaving it claiming a recording that has ended.
  publisher.clearCaptureUnknown();
  publisher.publishStopped();
}

/**
 * Summarize the meeting so far into minutes.
 *
 * The transcript is the worker's own — the merged, ordered lines it already holds
 * for the overlay, mapped to the request shape here rather than trusting a content
 * script to send it. One authenticated POST, its result published back to the
 * overlay as loading → ready/error.
 *
 * A missing or refused token is surfaced, not swallowed: the overlay cannot open
 * the popup, so the message names it as the way to sign in. A 401 clears the
 * stored token exactly as `verifyAccessToken` does, so the popup stops claiming
 * signed in while every request fails.
 */
async function generateMinutes(): Promise<void> {
  const turns = overlayLinesToMinutesSource(publisher.lines, MINUTES_LABELS);
  if (turns.length === 0) {
    publisher.setMinutes({ status: 'error', error: 'Nothing has been said yet to summarize.' });
    return;
  }

  const token = await loadAccessToken();
  if (token === null) {
    publisher.setMinutes({ status: 'error', error: MINUTES_SIGN_IN_MESSAGE });
    return;
  }

  publisher.setMinutes({ status: 'loading' });

  const { apiBaseUrl, direction } = await loadSettings();
  // The language the user READS — the target half of the direction — is the one
  // to write the minutes in, mirroring the web passing its UI locale.
  const language = direction === 'en_to_vi' ? 'vi' : 'en';
  const sessionId = captureSessionId ?? crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/minutes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ turns, language }),
    });
  } catch {
    publisher.setMinutes({ status: 'error', error: `Cannot reach ${apiBaseUrl}.` });
    return;
  }

  if (res.status === 401) {
    await clearAccessToken();
    publisher.setMinutes({ status: 'error', error: MINUTES_SIGN_IN_MESSAGE });
    return;
  }

  const body = (await res.json().catch(() => null)) as {
    data?: { minutes?: MeetingMinutes };
    error?: { message?: string };
  } | null;

  if (!res.ok || !body?.data?.minutes) {
    publisher.setMinutes({
      status: 'error',
      error: body?.error?.message ?? `Could not generate minutes (HTTP ${res.status}).`,
    });
    return;
  }

  publisher.setMinutes({ status: 'ready', minutes: body.data.minutes });
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

  if (publisher.capturing && activeTabId === tabId) {
    await stopCapture();
    return;
  }

  // Checked here as well as inside `startCapture`, so a switched-off platform
  // does not first produce the "cannot capture this tab" banner below on its way
  // to being refused anyway. The one in `startCapture` is the load-bearing one.
  //
  // Silent, both times. There is no overlay on a page Chatofy is off for, so
  // there is nowhere to render a complaint; the context-menu item is withheld
  // from that platform and the popup says so in words. A shortcut doing nothing
  // IS what the person who switched it off asked for.
  if (!runsOn(enablement, meetingSiteOf(tab?.url))) return;

  const support = supportOf(tab?.url);
  if (!support.ok) {
    // Sent straight to the tab rather than through the publisher, which only ever
    // addresses the captured one. On a page outside the match patterns there is no
    // content script listening and nothing happens, which is the right outcome:
    // the shortcut is global, and a page with no overlay has nowhere to complain.
    renderTo(tabId, {
      ...OverlayPublisher.blank(),
      errors: { capture: support.message },
      shortcut: shortcutHint,
    });
    return;
  }

  // Capture already running on another tab: `startCapture` clears that tab's
  // overlay before taking this one, so a plain start is the whole move.
  await startCapture(tabId);
}

/**
 * The relay into the meeting page stopped working.
 *
 * Reported once per state change rather than per frame: this fires at the rate
 * audio is produced, and a banner rewritten five times a second is a flicker.
 */
let relayFailure: string | undefined;
function reportRelayFailure(reason: string): void {
  if (relayFailure === reason) return;
  relayFailure = reason;
  publisher.publishError('outbound', reason);
}

/** Report a failed toggle the same way a failed start is reported. */
function reportToggleFailure(err: unknown): void {
  publisher.publishCaptureError(err instanceof Error ? err.message : 'Could not capture this tab');
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
  const stops = publisher.capturing && activeTabId !== null && tab?.id === activeTabId;
  await chrome.contextMenus.update(TOGGLE_MENU_ID, {
    title: stops ? 'Chatofy: stop translating' : 'Chatofy: start translating',
    // Withheld from platforms Chatofy is off for. In a call window with no
    // toolbar this menu is the only way in, so leaving it there would offer an
    // action the worker has already decided to refuse — and on Facebook, where
    // there is no icon and no badge to explain, that refusal would be invisible.
    // A missing item explains itself.
    documentUrlPatterns: enabledMeetingPatterns((site) => runsOn(enablement, site)),
  });
}

/**
 * Whether Chatofy may act on a tab, resolved from the tab's current URL.
 *
 * Asked rather than remembered: a tab that was a Meet when capture started can
 * navigate, and the answer that matters is the one at the moment of acting. A
 * tab that cannot be read at all resolves to allowed, matching `runsOn`'s rule
 * for an unidentifiable site — refusing on a failed lookup would break capture
 * for a reason nothing on screen could explain.
 */
async function runsOnTab(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  return runsOn(enablement, meetingSiteOf(tab?.url));
}

/**
 * Bring everything that depends on the preference back into line.
 *
 * A capture already running on a platform that has just been switched off is
 * STOPPED. Leaving it would contradict the person who just said the extension
 * should not act there, and it is also the only ordering that keeps the
 * recording indicator honest: the content script refuses to unmount the overlay
 * while it believes a capture is live, so the stop has to come from here for the
 * indicator to go away legitimately rather than by being hidden.
 */
async function applySiteEnablement(next: SiteEnablement): Promise<void> {
  enablement = next;
  await refreshMenuTitle().catch(() => undefined);
  if (!publisher.capturing || activeTabId === null) return;
  const tab = await chrome.tabs.get(activeTabId).catch(() => undefined);
  if (runsOn(enablement, meetingSiteOf(tab?.url))) return;
  await stopCapture();
}

export default defineBackground(() => {
  // Read early and kept in module scope: the worker is restarted constantly and
  // this is one `getAll` per restart, not per push.
  void chrome.commands
    .getAll()
    .then((commands) => {
      shortcutHint = commands.find((c) => c.name === TOGGLE_COMMAND)?.shortcut || undefined;
      publisher.setShortcut(shortcutHint);
    })
    .catch(() => undefined);

  // Restored first: the registration sync below publishes, and publishing before
  // the patched tabs are back would tell whoever is mid-meeting to reload.
  void (async () => {
    await patch.restore();
    const stored = await chrome.storage.session.get([ACTIVE_TAB_KEY, SESSION_ID_KEY]);
    if (typeof stored[ACTIVE_TAB_KEY] === 'number') setActiveTab(stored[ACTIVE_TAB_KEY]);
    if (typeof stored[SESSION_ID_KEY] === 'string') captureSessionId = stored[SESSION_ID_KEY];
    await refreshSettingsHint();
  })().catch(() => undefined);

  // Whether a capture is still running is the one piece of state that cannot be
  // restored from storage, because only the offscreen document knows: it holds
  // the audio graph and outlives this worker, which Chrome ends after about
  // thirty seconds of quiet. A restarted worker starts at `capturing: false`, and
  // several paths would republish that — a settings write, a tab update, a
  // failure inside the restore above — taking the recording indicator down in a
  // meeting that is still being recorded.
  //
  // Marked synchronously, before anything is awaited: the answer can come back
  // faster than a promise chain, and marking afterwards would leave the flag set
  // by the very reply meant to clear it. Marking when nothing is capturing costs
  // nothing — the restore above has not set a render target yet.
  //
  // If there is no document there is nothing running, and that IS the answer, so
  // the guess ends there. If there is one and the message fails, the flag stays:
  // not knowing is exactly the case it exists for, and leaving the indicator
  // alone is the safe half of the failure.
  publisher.markCaptureUnknown();
  void offscreen
    .requestStatus()
    .then((asked) => {
      if (!asked) publisher.clearCaptureUnknown();
    })
    .catch(() => undefined);

  // The popup writes the same two values this overlay shows. Without this, changing
  // the direction there would leave a running overlay showing the old one.
  chrome.storage.onChanged.addListener(() => {
    void refreshSettingsHint()
      .then(() => publisher.republish())
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

  // Read on every worker start, and watched for the rest of its life. The read
  // also rebuilds the menu, which is why it is not merged into the block above:
  // the item's patterns depend on it, and a restarted worker would otherwise
  // offer "start translating" on a platform it has been told to leave alone.
  void loadSiteEnablement()
    .then((stored) => applySiteEnablement(stored))
    .catch(() => undefined);
  watchSiteEnablement((next) => {
    void applySiteEnablement(next).catch(() => undefined);
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
        startCapture(forWorker.tabId).catch(reportToggleFailure);
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
            // Kept when the sender did not name one. The overlay's controls are
            // a subset of the popup's — it has no mode control — and this
            // message is built by hand in a content script that `sendMessage`
            // types as `any`, so a missing field is not a compile error. Taken
            // literally, changing the direction from the overlay would silently
            // reset the mode.
            mode: forWorker.mode ?? current.mode,
            voiceGender: forWorker.voiceGender,
            outbound: forWorker.outbound,
          });
          await refreshSettingsHint();

          // Reopened rather than patched in place: the offscreen document is handed
          // its settings once, when capture opens, and this keeps a single path that
          // opens one. The activeTab grant survives a stop, so re-minting the stream
          // id needs no new invocation.
          if (publisher.capturing && activeTabId !== null) {
            const tabId = activeTabId;
            await stopCapture();
            await startCapture(tabId);
          } else {
            publisher.republish();
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
        // Held until this worker knows whether a capture is running, because a
        // query is answered from state directly and so is the one render the
        // suppression in `publish` cannot reach. A page loading during the window
        // after a worker restart would otherwise be told nothing is being
        // recorded, and hide the indicator on a meeting that is.
        //
        // Bounded, because an answer that never comes is a content script that
        // renders nothing at all. On timeout it falls through to what is held,
        // which is the old behaviour rather than a new failure.
        void Promise.race([
          publisher.whenCaptureKnown(),
          new Promise((resolve) => setTimeout(resolve, QUERY_ANSWER_TIMEOUT_MS)),
        ]).then(() => {
          // Only the captured tab gets the captured tab's state. The publisher
          // holds one state for the whole extension, so answering every asker
          // with it told a second meeting — one nobody is recording — that it
          // was being recorded. The popup has no `sender.tab` and is asking
          // about whatever is running, so it keeps the full answer.
          sendResponse(
            sender.tab?.id !== undefined && sender.tab.id !== activeTabId
              ? { ...OverlayPublisher.blank(), shortcut: shortcutHint, settings: settingsHint }
              : publisher.current,
          );
        });
        // `true` keeps the message channel open for the response above.
        return true;

      case 'status':
        publisher.applyStatus(forWorker.status);
        return undefined;

      case 'transcript':
        publisher.applyTranscript(forWorker.lines);
        return undefined;

      case 'generateMinutes':
        // Reported through the overlay rather than rejected: the click that asked
        // for this came from a content script that is not awaiting a reply, so a
        // rejected promise nobody holds would be a silent failure.
        void generateMinutes().catch((err) => {
          publisher.setMinutes({
            status: 'error',
            error: err instanceof Error ? err.message : 'Could not generate minutes.',
          });
        });
        return undefined;

      case 'outbound.command': {
        // Straight through. This worker does not interpret the audio, and it is
        // the only context that can reach a tab from the offscreen document.
        const target = activeTabId;
        if (target === null) {
          reportRelayFailure('the meeting tab is no longer being tracked');
          return undefined;
        }
        void chrome.tabs
          .sendMessage(target, {
            to: 'content',
            type: 'outbound.command',
            command: forWorker.command,
          })
          // Reported rather than dropped. Silence here is the user talking into
          // a meeting that stopped receiving them, with nothing on screen saying
          // so.
          .catch(() => reportRelayFailure('the meeting tab stopped accepting audio'));
        return undefined;
      }

      case 'outbound.transmitting':
        // Only from the tab being captured. The patch runs on every matching
        // meeting page, so a second one's mute toggle would otherwise drive this
        // capture's gate.
        if (sender.tab?.id !== activeTabId) return undefined;
        void chrome.runtime
          .sendMessage({
            to: 'offscreen',
            type: 'outbound.transmitting',
            transmitting: forWorker.transmitting,
          })
          .catch(() => undefined);
        return undefined;

      default:
        return undefined;
    }
  });

  // A tab that closes or navigates takes the capture with it. Without this the
  // offscreen document would keep a dead stream open and the overlay would claim to
  // be capturing a tab that no longer exists.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void patch.forget(tabId);
    if (tabId === activeTabId) void stopCapture();
  });

  // A tab that navigates or reloads throws its document away, and with it the
  // page-world patch. `onRemoved` does not fire for that — it only fires on
  // close — so without this a reloaded meeting would stay marked as patched and
  // the overlay would keep claiming the user's speech was reaching it.
  //
  // Unfiltered, because `chrome.tabs.onUpdated` takes no filter; that is a
  // `webNavigation` feature, and buying it would mean asking for a permission to
  // avoid a cheap early return.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && patch.has(tabId)) {
      void patch.forget(tabId).then((changed) => {
        if (changed && tabId === activeTabId) publisher.republish();
      });
      return;
    }
    // Loaded: ask whether the new document got the patch. This is also what
    // recovers the answer after a service-worker restart, since the page has no
    // way to volunteer it.
    //
    // Only while the feature is on, and only for the tab being captured — this
    // event fires for every page load in the browser, and probing each one would
    // mean an `executeScript` attempt against tabs that have nothing to do with
    // any meeting.
    if (changeInfo.status === 'complete' && settingsHint?.outbound && tabId === activeTabId) {
      void refreshPatched(tabId);
    }
  });
});
