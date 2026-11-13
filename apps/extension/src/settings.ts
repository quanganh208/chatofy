import {
  DEFAULT_MIC_PROCESSING,
  DEFAULT_VOICE_GENDER,
  languagePairOf,
  type LanguagePair,
  type MicProcessing,
} from '@chatofy/types';
import type { CaptureSettings } from './messages';
import { readCachedPreferences } from './preferences-cache';
import { syncedFieldsOf } from './preferences-mapping';

/**
 * What this machine remembers about its meetings, and the one-off consent flag.
 *
 * Only what is about THIS machine lives here: whether its own microphone is in
 * play, how that microphone is processed, and whether timings are reported.
 * Which way the person reads a call, which voice speaks and which AI Context a
 * meeting runs under belong to the account and are read from its cached
 * preferences (`preferences-cache.ts`), so `loadSettings` hands a capture one
 * object assembled from both without either store holding the other's fields.
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
/**
 * The development fallback, exported so `.env.example` can be checked against
 * it instead of restating it by hand. The template shows this value as a
 * commented line, which only tells the truth while the two agree.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

const API_BASE_URL: string =
  (import.meta.env.WXT_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL;

/**
 * The pair a fresh capture opens with: English into Vietnamese.
 *
 * This is a meeting-capture default, not the web app's own: a meeting is
 * usually a call with someone speaking English while the user speaks
 * Vietnamese, so what needs translating first is the OTHER side speaking
 * English, into Vietnamese for the user to read.
 */
export const DEFAULT_CAPTURE_PAIR: LanguagePair = languagePairOf('en', 'vi');

/** What a capture needs from this machine's own store. */
type LocalSettings = Pick<CaptureSettings, 'reportMetrics' | 'outbound' | 'micProcessing'>;

const LOCAL_KEYS = ['reportMetrics', 'outbound', 'micProcessing'] as const;

const DEFAULT_LOCAL: LocalSettings = {
  reportMetrics: false,
  // Off. This leg opens the user's microphone and translates what they say
  // into the meeting; it is not something to discover after the fact.
  outbound: false,
  micProcessing: DEFAULT_MIC_PROCESSING,
};

/**
 * The stored mic processing switches, each one validated on its own.
 *
 * Field by field rather than all or nothing: a profile that saved one switch
 * keeps it even when another is missing or malformed, and a value that is not
 * an object at all reads as the defaults.
 */
function storedMicProcessing(value: Record<string, unknown> | undefined): MicProcessing {
  const candidate = value?.micProcessing;
  const raw = (typeof candidate === 'object' && candidate !== null ? candidate : {}) as Record<
    string,
    unknown
  >;
  const pick = (k: keyof MicProcessing): boolean => {
    const stored = raw[k];
    return typeof stored === 'boolean' ? stored : DEFAULT_MIC_PROCESSING[k];
  };
  return {
    echoCancellation: pick('echoCancellation'),
    noiseSuppression: pick('noiseSuppression'),
    autoGainControl: pick('autoGainControl'),
  };
}

export async function loadSettings(): Promise<CaptureSettings> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Record<string, unknown> | undefined;
  const cached = await readCachedPreferences();
  // Signed out (or never synced) there is no account document, so a capture
  // opens on the extension's own defaults. The pair and the voice are never read
  // from the local value: values an older build kept there are not imported.
  const synced = cached
    ? syncedFieldsOf(cached)
    : {
        languagePair: DEFAULT_CAPTURE_PAIR,
        voiceGender: DEFAULT_VOICE_GENDER,
        contextId: undefined,
      };
  return {
    ...synced,
    reportMetrics:
      typeof value?.reportMetrics === 'boolean' ? value.reportMetrics : DEFAULT_LOCAL.reportMetrics,
    outbound: typeof value?.outbound === 'boolean' ? value.outbound : DEFAULT_LOCAL.outbound,
    micProcessing: storedMicProcessing(value),
    // Never restored from storage. The build decides this now, and a value saved
    // by an older version points at whatever host that machine was developing
    // against.
    apiBaseUrl: API_BASE_URL,
  };
}

/**
 * Only this machine's own fields are written, picked by name.
 *
 * Callers build their argument by spreading a full settings object, and
 * TypeScript does not excess-property-check a spread, so the pair, the voice, the
 * context and `apiBaseUrl` all arrive at runtime with nothing in the type system
 * objecting. This function is the only place that can promise storage does not
 * carry them: the first three are the account's, the last is the build's.
 */
export async function saveSettings(settings: LocalSettings): Promise<void> {
  const persisted = Object.fromEntries(LOCAL_KEYS.map((key) => [key, settings[key]]));
  await chrome.storage.local.set({ [KEY]: persisted });
}

/**
 * Drop what an older build kept here that the account owns now: the pair, the
 * voice, the context and the pre-pair `direction`. Run once the popup uses the
 * account store, so an old value cannot be mistaken for a current one. Not
 * imported anywhere — the account's document starts from its own defaults.
 */
export async function dropLegacySyncedSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Record<string, unknown> | undefined;
  if (!value) return;
  const extra = Object.keys(value).filter((k) => !(LOCAL_KEYS as readonly string[]).includes(k));
  if (extra.length === 0) return;
  await chrome.storage.local.set({
    [KEY]: Object.fromEntries(LOCAL_KEYS.filter((k) => k in value).map((k) => [k, value[k]])),
  });
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
