import { DEFAULT_VOICE_GENDER } from '@chatofy/types';
import type { CaptureSettings } from './messages';

/**
 * What the popup remembers between meetings, and the one-off consent flag.
 *
 * `chrome.storage.local` rather than `sync`: the API base URL is a local
 * development address more often than not, and syncing it to another machine would
 * point that machine at a host it cannot reach.
 */

const KEY = 'chatofy.settings';
const NOTICE_KEY = 'chatofy.recordingNoticeSeen';

const DEFAULT_SETTINGS: CaptureSettings = {
  direction: 'en_to_vi',
  voiceGender: DEFAULT_VOICE_GENDER,
  apiBaseUrl: 'http://localhost:3000',
  reportMetrics: false,
};

export async function loadSettings(): Promise<CaptureSettings> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Partial<CaptureSettings> | undefined;
  // Merged over the defaults rather than used as-is: a stored object written by an
  // older version is missing whatever has been added since, and a missing
  // `apiBaseUrl` would make the socket URL `undefined` at connect time.
  return { ...DEFAULT_SETTINGS, ...value };
}

export async function saveSettings(settings: CaptureSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

/**
 * Whether the recording notice has already been shown.
 *
 * Kept apart from the settings object because it is not a setting: it records that
 * something was said to the user once, and folding it into a value the user edits
 * invites it to be reset by an unrelated change.
 */
export async function recordingNoticeSeen(): Promise<boolean> {
  const stored = await chrome.storage.local.get(NOTICE_KEY);
  return stored[NOTICE_KEY] === true;
}

export async function markRecordingNoticeSeen(): Promise<void> {
  await chrome.storage.local.set({ [NOTICE_KEY]: true });
}
