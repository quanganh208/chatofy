import { DEFAULT_TRANSLATE_MODE, DEFAULT_VOICE_GENDER } from '@chatofy/types';
import type { CaptureSettings } from './messages';

/**
 * What the popup remembers between meetings, and the one-off consent flag.
 *
 * `chrome.storage.local` rather than `sync`: these are choices about one
 * machine's meetings — which way this person reads a call, and whether their own
 * microphone is in play — and carrying them to another machine would change what
 * a capture does there without anyone asking for it.
 */

const KEY = 'chatofy.settings';
const NOTICE_KEY = 'chatofy.recordingNoticeSeen';

/**
 * Where the API lives, decided at build time and not by the user.
 *
 * There used to be a field in the popup for this, which made it the one setting
 * a person could edit into something unreachable. It is gone, so the value has
 * to arrive with the bundle. Missing here means a development build: `wxt zip`
 * refuses to package without it, so nothing carrying this placeholder can be
 * released.
 */
const API_BASE_URL = import.meta.env.WXT_API_BASE_URL ?? 'http://localhost:3000';

const DEFAULT_SETTINGS: CaptureSettings = {
  direction: 'en_to_vi',
  mode: DEFAULT_TRANSLATE_MODE,
  voiceGender: DEFAULT_VOICE_GENDER,
  apiBaseUrl: API_BASE_URL,
  reportMetrics: false,
  // Off. This direction opens the user's microphone and translates what they say
  // into the meeting; it is not something to discover after the fact.
  outbound: false,
};

export async function loadSettings(): Promise<CaptureSettings> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Partial<CaptureSettings> | undefined;
  // Merged over the defaults rather than used as-is: a stored object written by an
  // older version is missing whatever has been added since, and a missing
  // `apiBaseUrl` would make the socket URL `undefined` at connect time.
  const merged = { ...DEFAULT_SETTINGS, ...value };
  return {
    ...merged,
    // Anything other than the cascade is read back as the cascade. The popup no
    // longer offers a choice, so a stored value from when it did would pin that
    // profile to a backend with no surface left to leave it by — and the profiles
    // most likely to hold one belong to whoever was comparing the two. Written as
    // a whitelist rather than a check for the one mode that was removed, so a
    // corrupt or future value lands on the same safe side.
    mode: merged.mode === 'cascade' ? 'cascade' : DEFAULT_TRANSLATE_MODE,
    // Never restored from storage. The build decides this now, and a value saved
    // by an older version points at whatever host that machine was developing
    // against.
    apiBaseUrl: API_BASE_URL,
  };
}

export async function saveSettings(settings: CaptureSettings): Promise<void> {
  // `apiBaseUrl` is deliberately not persisted: it comes from the build, and
  // writing it back would leave storage carrying a value that is read by nothing
  // and contradicts the bundle.
  const { apiBaseUrl: _apiBaseUrl, ...persisted } = settings;
  await chrome.storage.local.set({ [KEY]: persisted });
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
