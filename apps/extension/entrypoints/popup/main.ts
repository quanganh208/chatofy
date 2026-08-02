import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import type { OverlayState } from '../../src/messages';
import {
  microphonePermission,
  openMicrophonePermissionPage,
} from '../../src/microphone-permission';
import {
  loadSettings,
  markRecordingNoticeSeen,
  recordingNoticeSeen,
  saveSettings,
} from '../../src/settings';
import { supportOf } from '../../src/supported-meeting-url';

/**
 * The popup: pick a direction and a voice, start, stop.
 *
 * MV3 popups close whenever they lose focus, which is why nothing about a running
 * capture lives here. The state is asked for on open and pushed to the overlay while
 * running — the overlay is the surface that survives a meeting, and this one is a
 * control panel that happens to be visible for a few seconds at a time.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const notice = el<HTMLDivElement>('notice');
const noticeOk = el<HTMLButtonElement>('notice-ok');
const unsupported = el<HTMLDivElement>('unsupported');
const capture = el<HTMLDivElement>('capture');
const direction = el<HTMLSelectElement>('direction');
const voice = el<HTMLSelectElement>('voice');
const api = el<HTMLInputElement>('api');
const metrics = el<HTMLInputElement>('metrics');
const outbound = el<HTMLInputElement>('outbound');
const mic = el<HTMLDivElement>('mic');
const micAllow = el<HTMLButtonElement>('mic-allow');
const toggle = el<HTMLButtonElement>('toggle');
const status = el<HTMLDivElement>('status');

let capturing = false;

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

/** The first failure there is, named by which direction it belongs to. */
function firstFailure(state: OverlayState | undefined): string | undefined {
  const errors = state?.errors;
  if (!errors) return undefined;
  if (errors.capture) return errors.capture;
  if (errors.inbound) return `Meeting audio: ${errors.inbound}`;
  if (errors.outbound) return `Your microphone: ${errors.outbound}`;
  return undefined;
}

function renderStatus(state: OverlayState | undefined): void {
  capturing = state?.capturing ?? false;
  toggle.textContent = capturing ? 'Stop' : 'Start';
  const failure = firstFailure(state);
  if (failure) {
    status.textContent = failure;
    return;
  }
  if (!capturing) {
    status.textContent = 'Idle.';
    return;
  }
  status.textContent =
    state?.outbound === 'monitor'
      ? 'Capturing this tab. Your speech is translated for you only.'
      : state?.outbound === 'sending'
        ? 'Capturing this tab, and translating your speech into the meeting.'
        : 'Capturing this tab.';
}

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  direction.value = settings.direction;
  voice.value = settings.voiceGender;
  api.value = settings.apiBaseUrl;
  metrics.checked = settings.reportMetrics;
  outbound.checked = settings.outbound;

  // Shown once, ever, and only dismissed by the button — which is also what records
  // that it was seen. Anyone who has read it has actively acknowledged it.
  if (!(await recordingNoticeSeen())) notice.hidden = false;

  await refreshMicrophoneNotice();

  const tab = await currentTab();
  const support = supportOf(tab?.url);
  unsupported.hidden = support.ok;
  unsupported.textContent = support.message ?? '';
  // Only the Start button depends on the tab. The settings above it are global and
  // stay reachable from any tab — during a call in its own window, an ordinary tab
  // is the only place this popup can be opened at all.
  capture.hidden = !support.ok;

  const state = (await chrome.runtime
    .sendMessage({ to: 'worker', type: 'query' })
    .catch(() => undefined)) as OverlayState | undefined;
  renderStatus(state);
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
    voiceGender: voice.value as VoiceGender,
    apiBaseUrl: base.url,
    reportMetrics: metrics.checked,
    outbound: outbound.checked,
  });
};

for (const input of [api, metrics]) {
  input.addEventListener('change', () => void persist());
}

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

noticeOk.addEventListener('click', () => {
  notice.hidden = true;
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
