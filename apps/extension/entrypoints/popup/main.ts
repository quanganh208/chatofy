import { DEFAULT_TRANSLATE_MODE } from '@chatofy/types';
import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import type { CaptureSettings, OverlayState } from '../../src/messages';
import {
  microphonePermission,
  openMicrophonePermissionPage,
} from '../../src/microphone-permission';
import {
  loadSiteEnablement,
  runsOn,
  saveSiteEnablement,
  withSiteEnabled,
  type SiteEnablement,
} from '../../src/site-enablement';
import {
  loadSettings,
  markRecordingNoticeSeen,
  recordingNoticeSeen,
  saveSettings,
} from '../../src/settings';
import {
  meetingSiteName,
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
const direction = el<HTMLSelectElement>('direction');
const voice = el<HTMLSelectElement>('voice');
const outbound = el<HTMLInputElement>('outbound');
const mic = el<HTMLDivElement>('mic');
const micAllow = el<HTMLButtonElement>('mic-allow');
const runEnabled = el<HTMLInputElement>('run-enabled');
const runSites = el<HTMLDivElement>('run-sites');
const toggle = el<HTMLButtonElement>('toggle');
const status = el<HTMLDivElement>('status');

let capturing = false;
/** Whether the tab under this popup can be captured at all. Gates Start, only. */
let captureable = false;
let enablement: SiteEnablement = { enabled: true, disabledSites: [] };
let site: MeetingSite | undefined;
let currentTabUrl: string | undefined;
/**
 * The last state the worker reported, replayed when something else changes what
 * the footer should say — switching the current platform off has to move Start
 * to disabled without waiting for the worker to speak again.
 */
let lastOverlayState: OverlayState | undefined;
/** One checkbox per platform, built once and kept for the state refresh. */
const siteToggles = new Map<MeetingSite, HTMLInputElement>();

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
 * One row per platform, built from the module that owns the URL patterns.
 *
 * Every platform, always, regardless of the tab this popup was opened over.
 * Built rather than written into the markup for the same reason the unsupported
 * list is: three rows hand-maintained beside three patterns is three rows that
 * will eventually disagree with what the extension matches.
 *
 * The label reads as "on", not "off", so it points the same way as the master
 * switch above it. A pair where one is an opt-in and the other an opt-out is a
 * pair someone will read backwards.
 */
function buildSiteToggles(): void {
  for (const meeting of SUPPORTED_MEETINGS) {
    const row = document.createElement('div');
    row.className = 'row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `run-${meeting.site}`;
    input.addEventListener('change', () => {
      void persistEnablement(withSiteEnabled(enablement, meeting.site, input.checked));
    });

    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = meeting.name;

    // The qualification that a prose list buried — Zoom means the web client,
    // Facebook includes Messenger. It rides on the switch now, which is the only
    // place these three are named, so it is also the answer to "which Zoom?".
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = meeting.detail;

    // Says which of the three the popup is standing over, so the row that
    // matters right now does not have to be worked out from the header.
    const here = document.createElement('span');
    here.className = 'here';
    here.textContent = 'this tab';
    here.hidden = true;

    row.append(input, label, detail, here);
    runSites.append(row);
    siteToggles.set(meeting.site, input);
  }
}

function refreshRunControls(): void {
  runEnabled.checked = enablement.enabled;
  for (const [key, input] of siteToggles) {
    input.checked = runsOn(enablement, key);
    // Nothing to say about one platform while Chatofy is off everywhere.
    input.disabled = !enablement.enabled;
    const here = input.parentElement?.querySelector<HTMLSpanElement>('.here');
    if (here) here.hidden = key !== site;
  }
}

async function persistEnablement(next: SiteEnablement): Promise<void> {
  enablement = next;
  refreshRunControls();
  // Gates Start as well: a platform Chatofy is off for cannot be captured, and
  // the worker refuses it, so offering the button would be offering nothing.
  captureable = supportOf(currentTabUrl).ok && runsOn(next, site);
  renderStatus(lastOverlayState);
  await saveSiteEnablement(next);
}

/**
 * Why this tab cannot be captured, when it cannot.
 *
 * One line. Naming the three platforms here as well as in the switches below
 * meant the popup said the same thing twice and pushed the switches off screen,
 * which is the opposite of useful to the reader who is on the wrong tab.
 */
function renderSupport(support: MeetingSupport): void {
  unsupported.hidden = support.ok;
  unsupported.classList.toggle('action', support.kind === 'action');
  unsupportedMessage.textContent = support.message ?? '';
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
  lastOverlayState = overlay;
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
    // Being switched off is a different answer from being the wrong kind of tab,
    // and it is the one with a fix the reader can reach from this very popup.
    status.textContent = captureable
      ? 'Ready.'
      : site && !runsOn(enablement, site)
        ? `Chatofy is off on ${meetingSiteName(site)}.`
        : 'Not available on this tab.';
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
  voice.value = settings.voiceGender;
  unexposed = settings;
  outbound.checked = settings.outbound;

  // Shown once, ever, and only dismissed by the button — which is also what records
  // that it was seen. Anyone who has read it has actively acknowledged it.
  showConsent(!(await recordingNoticeSeen()));

  await refreshMicrophoneNotice();

  const tab = await currentTab();
  currentTabUrl = tab?.url;
  const support = supportOf(currentTabUrl);
  renderSupport(support);

  site = meetingSiteOf(currentTabUrl);
  host.textContent = site ?? (currentTabUrl ? new URL(currentTabUrl).hostname : '');

  enablement = await loadSiteEnablement();
  refreshRunControls();
  // Both gates, in the order the worker applies them: a tab Chrome cannot capture,
  // or a platform the user switched off.
  captureable = support.ok && runsOn(enablement, site);

  const overlay = (await chrome.runtime
    .sendMessage({ to: 'worker', type: 'query' })
    .catch(() => undefined)) as OverlayState | undefined;
  renderStatus(overlay);
  refreshScrollFade();
}

/**
 * The settings this page does not offer, carried through a write unchanged.
 *
 * Two of them survive the controls that used to set them. `apiBaseUrl` is decided
 * when the extension is compiled and is not restored from storage at all;
 * `reportMetrics` still gates the per-turn timing the measurement path collects,
 * and its consumers reach from the worker into the realtime client. Neither has a
 * control here any more, and neither should be reset to a default by a write that
 * happened because someone picked a different voice.
 */
let unexposed: CaptureSettings | undefined;

const persist = () => {
  // Nothing to write before the first read: the fields this page does not show
  // would be written as whatever a default says rather than as what is stored.
  if (!unexposed) return Promise.resolve();
  return saveSettings({
    ...unexposed,
    direction: direction.value as TranslationDirection,
    // Written explicitly rather than carried through, because there is no longer a
    // control that could have set it. `loadSettings` coerces a stored value from
    // when there was one, and naming the default here keeps this write from
    // reintroducing what that coercion exists to remove.
    mode: DEFAULT_TRANSLATE_MODE,
    voiceGender: voice.value as VoiceGender,
    outbound: outbound.checked,
  });
};

// Its own store and its own write path, deliberately. Where the extension may
// run is not a capture setting, and routing it through the worker's `settings`
// message would reopen a running capture — restarting a translation because
// someone changed a checkbox about a different platform.
runEnabled.addEventListener('change', () => {
  void persistEnablement({ ...enablement, enabled: runEnabled.checked });
});
buildSiteToggles();

// The three the offscreen document is handed at capture time go through the
// worker instead of straight to storage, because a running capture has to be
// reopened for a change to take effect and only the worker can do that. Writing
// them here would leave the popup showing a setting the live capture is not
// using — and for `outbound` that contradiction is visible, since the overlay
// renders it as status as well.
for (const input of [direction, voice, outbound]) {
  input.addEventListener('change', () => {
    // Turning the outbound direction on is the moment the microphone starts
    // mattering, and the moment to say it is still missing — not after a capture
    // has already started and produced nothing.
    void refreshMicrophoneNotice();
    void chrome.runtime
      .sendMessage({
        to: 'worker',
        type: 'settings',
        direction: direction.value as TranslationDirection,
        mode: DEFAULT_TRANSLATE_MODE,
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
