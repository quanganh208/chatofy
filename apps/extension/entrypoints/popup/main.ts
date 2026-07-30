import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import type { OverlayState } from '../../src/messages';
import {
  loadSettings,
  markRecordingNoticeSeen,
  recordingNoticeSeen,
  saveSettings,
} from '../../src/settings';

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
const controls = el<HTMLDivElement>('controls');
const direction = el<HTMLSelectElement>('direction');
const voice = el<HTMLSelectElement>('voice');
const api = el<HTMLInputElement>('api');
const metrics = el<HTMLInputElement>('metrics');
const toggle = el<HTMLButtonElement>('toggle');
const status = el<HTMLDivElement>('status');

let capturing = false;

/** Where this extension can and cannot work, and why. */
function supportOf(url: string | undefined): { ok: boolean; message?: string } {
  if (!url) {
    return { ok: false, message: 'Open a meeting tab first.' };
  }
  if (/^https:\/\/([^.]+\.)*zoom\.us\//.test(url) && !url.includes('/wc/')) {
    // Named explicitly rather than left to fail. A tab that is not the web client
    // cannot be captured, and without this the extension would appear to do nothing
    // for a reason nobody could guess.
    return {
      ok: false,
      message:
        'This looks like Zoom, but not the web client. The Zoom desktop app is not a ' +
        'browser tab, so its audio cannot be captured. Join from “Join from your ' +
        'browser” instead.',
    };
  }
  const supported =
    /^https:\/\/meet\.google\.com\//.test(url) ||
    /^https:\/\/([^.]+\.)*zoom\.us\/wc\//.test(url) ||
    /^https:\/\/www\.messenger\.com\//.test(url);
  if (!supported) {
    return {
      ok: false,
      message: 'Chatofy works on Google Meet, Zoom web, and Messenger web.',
    };
  }
  return { ok: true };
}

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
  controls.hidden = !support.ok;

  const state = (await chrome.runtime
    .sendMessage({ to: 'worker', type: 'query' })
    .catch(() => undefined)) as OverlayState | undefined;
  renderStatus(state);
}

const persist = () =>
  saveSettings({
    direction: direction.value as TranslationDirection,
    voiceGender: voice.value as VoiceGender,
    apiBaseUrl: api.value.trim() || 'http://localhost:3000',
    reportMetrics: metrics.checked,
  });

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
