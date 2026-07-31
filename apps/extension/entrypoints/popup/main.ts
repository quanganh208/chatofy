import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import type { OverlayState } from '../../src/messages';
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
const toggle = el<HTMLButtonElement>('toggle');
const status = el<HTMLDivElement>('status');

let capturing = false;

function renderStatus(state: OverlayState | undefined): void {
  capturing = state?.capturing ?? false;
  toggle.textContent = capturing ? 'Stop' : 'Start';
  status.textContent = state?.error ? state.error : capturing ? 'Capturing this tab.' : 'Idle.';
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

  // Shown once, ever, and only dismissed by the button — which is also what records
  // that it was seen. Anyone who has read it has actively acknowledged it.
  if (!(await recordingNoticeSeen())) notice.hidden = false;

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
  });
};

for (const input of [direction, voice, api, metrics]) {
  input.addEventListener('change', () => void persist());
}

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
      renderStatus({ capturing: false, lines: [] });
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
    renderStatus({ capturing: true, lines: [] });
  })();
});

void init();
