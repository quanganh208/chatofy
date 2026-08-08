import type { TranslateMode, TranslationDirection, VoiceGender } from '@chatofy/types';
import type { OverlayState } from '../../src/messages';
import {
  microphonePermission,
  openMicrophonePermissionPage,
} from '../../src/microphone-permission';
import {
  loadOverlayVisibility,
  overlayShownOn,
  saveOverlayVisibility,
  withSiteShown,
  type OverlayVisibility,
} from '../../src/overlay-visibility';
import {
  loadSettings,
  markRecordingNoticeSeen,
  recordingNoticeSeen,
  saveSettings,
} from '../../src/settings';
import {
  meetingSiteOf,
  supportOf,
  SUPPORTED_MEETINGS,
  type MeetingSite,
  type MeetingSupport,
} from '../../src/supported-meeting-url';
import { POPUP_STYLE } from './styles';

/**
 * The popup: pick a direction and a voice, start, stop.
 *
 * MV3 popups close whenever they lose focus, which is why nothing about a running
 * capture lives here. The state is asked for on open and pushed to the overlay while
 * running — the overlay is the surface that survives a meeting, and this one is a
 * control panel that happens to be visible for a few seconds at a time.
 */

// First, before anything queries the DOM: the markup carries only enough style to
// avoid a white flash, and the rest is built from the shared tokens. `textContent`
// rather than `innerHTML` here as everywhere in this extension, even though this
// string is ours and this page is not a meeting's.
const style = document.createElement('style');
style.textContent = POPUP_STYLE;
document.head.append(style);

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const consent = el<HTMLDivElement>('consent');
const consentOk = el<HTMLButtonElement>('consent-ok');
const chromeBar = el<HTMLElement>('chrome');
const settingsPane = el<HTMLElement>('settings');
const capture = el<HTMLElement>('capture');
const host = el<HTMLParagraphElement>('host');
const state = el<HTMLSpanElement>('state');
const stateText = el<HTMLSpanElement>('state-text');
const unsupported = el<HTMLDivElement>('unsupported');
const unsupportedMessage = el<HTMLParagraphElement>('unsupported-message');
const unsupportedLabel = el<HTMLParagraphElement>('unsupported-label');
const unsupportedSites = el<HTMLUListElement>('unsupported-sites');
const direction = el<HTMLSelectElement>('direction');
const mode = el<HTMLSelectElement>('mode');
const modeNote = el<HTMLParagraphElement>('mode-note');
const voice = el<HTMLSelectElement>('voice');
const api = el<HTMLInputElement>('api');
const metrics = el<HTMLInputElement>('metrics');
const outbound = el<HTMLInputElement>('outbound');
const mic = el<HTMLDivElement>('mic');
const micAllow = el<HTMLButtonElement>('mic-allow');
const overlayEnabled = el<HTMLInputElement>('overlay-enabled');
const overlaySiteRow = el<HTMLDivElement>('overlay-site-row');
const overlaySite = el<HTMLInputElement>('overlay-site');
const overlaySiteLabel = el<HTMLLabelElement>('overlay-site-label');
const toggle = el<HTMLButtonElement>('toggle');
const status = el<HTMLDivElement>('status');

/** What the per-platform switch calls the platform. The storage key is the domain. */
const SITE_NAMES: Record<MeetingSite, string> = {
  'meet.google.com': 'Google Meet',
  'zoom.us': 'Zoom',
  'facebook.com': 'Facebook',
};

let capturing = false;
/** Whether the tab under this popup can be captured at all. Gates Start, only. */
let captureable = false;
let visibility: OverlayVisibility = { enabled: true, disabledSites: [] };
let site: MeetingSite | undefined;

/**
 * Show the way to grant the microphone, when there is one to show.
 *
 * Re-asked rather than read once, because the answer changes while this popup is
 * closed: granting happens in another tab, and the popup that opens afterwards must
 * not still be offering to ask.
 */
async function refreshMicrophoneNotice(): Promise<void> {
  mic.hidden = !outbound.checked || (await microphonePermission()) === 'granted';
}

/**
 * Say what the chosen mode changes, and disable what it makes meaningless.
 *
 * The voice selector is the reason this exists rather than a static line of
 * help: the live model speaks with its own voice and takes no selector, and a
 * control that silently does nothing is worse than one that says why it cannot.
 */
function refreshModeNote(): void {
  const live = mode.value === 'live';
  modeNote.textContent = live
    ? 'One model, end to end. It answers about three seconds behind and keeps talking over pauses — wear headphones.'
    : 'Recognise, translate, speak. Waits for a sentence to finish before answering.';
  voice.disabled = live;
}

/**
 * The per-platform switch, which only makes sense on a platform.
 *
 * Off — the checkbox unchecked — means the overlay is suppressed there. It reads
 * as "show", not as "hide", so that both switches point the same way; a pair
 * where one is an opt-in and the other an opt-out is a pair someone will get
 * backwards.
 */
function refreshOverlayControls(): void {
  overlayEnabled.checked = visibility.enabled;
  overlaySiteRow.hidden = site === undefined;
  if (site) {
    overlaySiteLabel.textContent = `Show on ${SITE_NAMES[site]}`;
    overlaySite.checked = overlayShownOn(visibility, site);
    // Nothing to say about one platform while the overlay is off everywhere.
    overlaySite.disabled = !visibility.enabled;
  }
}

async function persistVisibility(next: OverlayVisibility): Promise<void> {
  visibility = next;
  refreshOverlayControls();
  await saveOverlayVisibility(next);
}

/**
 * Why this tab cannot be captured, when it cannot.
 *
 * The platform rows are built here rather than written into the markup so they
 * cannot disagree with `SUPPORTED_MEETINGS`, and only for the ordinary case —
 * someone already on Zoom's desktop link does not need three rows telling them
 * Zoom is supported. They carry a `title` as well, because the qualification
 * beside each name is the part that gets truncated on a 320px page and it is
 * also the part worth reading.
 */
function renderSupport(support: MeetingSupport): void {
  unsupported.hidden = support.ok;
  unsupported.classList.toggle('action', support.kind === 'action');
  unsupportedMessage.textContent = support.message ?? '';

  const listed = !support.ok && support.kind !== 'action';
  unsupportedLabel.hidden = !listed;
  unsupportedSites.hidden = !listed;
  unsupportedSites.replaceChildren();
  if (!listed) return;

  for (const meeting of SUPPORTED_MEETINGS) {
    const row = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = meeting.name;
    const detail = document.createElement('span');
    detail.textContent = meeting.detail;
    row.title = `${meeting.name} — ${meeting.detail}`;
    row.append(name, detail);
    unsupportedSites.append(row);
  }
}

/** The first failure there is, named by which direction it belongs to. */
function firstFailure(overlay: OverlayState | undefined): string | undefined {
  const errors = overlay?.errors;
  if (!errors) return undefined;
  if (errors.capture) return errors.capture;
  if (errors.inbound) return `Meeting audio: ${errors.inbound}`;
  if (errors.outbound) return `Your microphone: ${errors.outbound}`;
  return undefined;
}

function renderStatus(overlay: OverlayState | undefined): void {
  capturing = overlay?.capturing ?? false;
  toggle.textContent = capturing ? 'Stop' : 'Start';
  toggle.classList.toggle('stop', capturing);
  // Stop is always available; Start is not. A capture that a reload or a tab
  // switch left running must stay stoppable from here even when this tab is no
  // longer one Chrome would let us start on.
  toggle.disabled = !capturing && !captureable;

  state.classList.toggle('live', capturing);
  stateText.textContent = capturing ? 'Recording' : 'Idle';

  const failure = firstFailure(overlay);
  if (failure) {
    status.textContent = failure;
    return;
  }
  if (!capturing) {
    // A disabled control has to say why, next to itself. The notice at the top of
    // the popup carries the detail, but it is a scroll away from this button on a
    // tab with the platform list showing — and a button that is simply grey, with
    // its explanation off screen, reads as broken rather than as unavailable.
    status.textContent = captureable ? 'Ready.' : 'Not available on this tab.';
    return;
  }
  status.textContent =
    overlay?.outbound === 'monitor'
      ? 'Capturing this tab. Your speech is translated for you only.'
      : overlay?.outbound === 'sending'
        ? 'Capturing this tab, and translating your speech into the meeting.'
        : 'Capturing this tab.';
}

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Mark the settings pane as scrolling, when it is.
 *
 * Measured rather than assumed, because whether it overflows depends on what the
 * tab is: the platform list adds ~130px on a tab that is not a meeting, and
 * Advanced adds more when it is opened. Re-measured after anything that changes
 * the height — a fade that outlives its reason is the artefact it was added to
 * remove.
 */
function refreshScrollFade(): void {
  settingsPane.classList.toggle('scrolls', settingsPane.scrollHeight > settingsPane.clientHeight);
}

/** The consent step owns the whole popup while it is up. */
function showConsent(show: boolean): void {
  consent.hidden = !show;
  chromeBar.hidden = show;
  settingsPane.hidden = show;
  capture.hidden = show;
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  direction.value = settings.direction;
  mode.value = settings.mode;
  refreshModeNote();
  voice.value = settings.voiceGender;
  api.value = settings.apiBaseUrl;
  metrics.checked = settings.reportMetrics;
  outbound.checked = settings.outbound;

  // Shown once, ever, and only dismissed by the button — which is also what records
  // that it was seen. Anyone who has read it has actively acknowledged it.
  showConsent(!(await recordingNoticeSeen()));

  await refreshMicrophoneNotice();

  const tab = await currentTab();
  const support = supportOf(tab?.url);
  captureable = support.ok;
  renderSupport(support);

  site = meetingSiteOf(tab?.url);
  host.textContent = site ?? (tab?.url ? new URL(tab.url).hostname : '');

  visibility = await loadOverlayVisibility();
  refreshOverlayControls();

  const overlay = (await chrome.runtime
    .sendMessage({ to: 'worker', type: 'query' })
    .catch(() => undefined)) as OverlayState | undefined;
  renderStatus(overlay);
  refreshScrollFade();
}

/**
 * A usable API base, or the default.
 *
 * Validated here rather than left to fail at connect time: `translateSocketUrl` throws
 * on an unparseable value, inside the session's own try, so a typo surfaces as a
 * generic "could not start" banner with nothing pointing at the field that caused it.
 */
function normalisedApiBase(raw: string): { url: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: 'http://localhost:3000' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: 'http://localhost:3000', error: 'The server must be an http(s) URL.' };
    }
    return { url: trimmed };
  } catch {
    return { url: 'http://localhost:3000', error: 'That server address is not a URL.' };
  }
}

const persist = () => {
  const base = normalisedApiBase(api.value);
  if (base.error) status.textContent = base.error;
  return saveSettings({
    direction: direction.value as TranslationDirection,
    mode: mode.value as TranslateMode,
    voiceGender: voice.value as VoiceGender,
    apiBaseUrl: base.url,
    reportMetrics: metrics.checked,
    outbound: outbound.checked,
  });
};

for (const input of [api, metrics]) {
  input.addEventListener('change', () => void persist());
}

// Its own store and its own write path, deliberately. Whether a panel is drawn is
// not a capture setting, and routing it through the worker's `settings` message
// would reopen a running capture — restarting a translation because someone hid
// an overlay.
overlayEnabled.addEventListener('change', () => {
  void persistVisibility({ ...visibility, enabled: overlayEnabled.checked });
});
overlaySite.addEventListener('change', () => {
  if (!site) return;
  void persistVisibility(withSiteShown(visibility, site, overlaySite.checked));
});

// The three the offscreen document is handed at capture time go through the
// worker instead of straight to storage, because a running capture has to be
// reopened for a change to take effect and only the worker can do that. Writing
// them here would leave the popup showing a setting the live capture is not
// using — and for `outbound` that contradiction is visible, since the overlay
// renders it as status as well.
for (const input of [direction, mode, voice, outbound]) {
  input.addEventListener('change', () => {
    // Turning the outbound direction on is the moment the microphone starts
    // mattering, and the moment to say it is still missing — not after a capture
    // has already started and produced nothing.
    void refreshMicrophoneNotice();
    // `mode` joins this group rather than the persist-only one above for the
    // same reason the other three are here: a running capture is handed its
    // settings once, so a mode changed mid-call only takes effect when the
    // worker reopens the capture. Writing it straight to storage would leave
    // this popup naming a backend the live capture is not using.
    refreshModeNote();
    void chrome.runtime
      .sendMessage({
        to: 'worker',
        type: 'settings',
        direction: direction.value as TranslationDirection,
        mode: mode.value as TranslateMode,
        voiceGender: voice.value as VoiceGender,
        outbound: outbound.checked,
      })
      .catch(() => undefined);
  });
}

// Opens a tab and lets this popup die with it. The prompt takes focus, and a popup
// that has lost focus is already closing — trying to keep this one alive to report
// the outcome would race Chrome for it and lose. The grant page reports it instead.
micAllow.addEventListener('click', () => {
  void openMicrophonePermissionPage();
});

consentOk.addEventListener('click', () => {
  showConsent(false);
  // The pane had no layout while the consent step covered it, so anything
  // measured before this point was measured on a hidden element.
  refreshScrollFade();
  void markRecordingNoticeSeen();
});

// Opening Advanced adds roughly a hundred pixels, which is usually the thing
// that tips this pane into scrolling.
el<HTMLDetailsElement>('advanced').addEventListener('toggle', refreshScrollFade);

toggle.addEventListener('click', () => {
  void (async () => {
    // Saved before starting, not after: the worker reads settings from storage when
    // it opens the offscreen document, so an unsaved change would start a capture
    // with the previous direction.
    await persist();

    if (capturing) {
      await chrome.runtime.sendMessage({ to: 'worker', type: 'stop' });
      renderStatus({ capturing: false, lines: [], outbound: 'off', errors: {} });
      return;
    }

    const tab = await currentTab();
    if (tab?.id === undefined) {
      status.textContent = 'No tab to capture.';
      return;
    }
    await chrome.runtime.sendMessage({ to: 'worker', type: 'start', tabId: tab.id });
    // Reported optimistically. The popup is usually closed before capture finishes
    // opening, and the overlay carries the real answer, including any failure.
    renderStatus({
      capturing: true,
      lines: [],
      // What the offscreen document reports will replace this; the popup is
      // usually closed before it arrives.
      outbound: outbound.checked ? 'monitor' : 'off',
      errors: {},
    });
  })();
});

void init();
