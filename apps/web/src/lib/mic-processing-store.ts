/**
 * The browser's microphone processing, kept on THIS device.
 *
 * The one translate setting that does not follow the account: echo cancellation,
 * noise suppression and gain control answer to a machine's microphone and speakers,
 * and the right chain for a headset on a laptop is the wrong one for a phone held
 * at arm's length. Everything else a reader sets lives in the account document
 * (`translate-settings-preferences.ts`).
 *
 * It used to ride inside the old local settings blob. The value a device had there
 * is carried over once, before that blob is removed, so nobody's microphone setup
 * changes under them: {@link loadMicProcessing} reads the old blob while the new key
 * is absent, and {@link carryLegacyMicProcessing} copies it across ahead of cleanup.
 *
 * Every storage touch is wrapped: Safari private mode and a disabled-storage policy
 * throw on access, and a microphone setting must never take a screen down with it.
 */
import { DEFAULT_MIC_PROCESSING, type MicProcessing } from '@chatofy/types';
import { parseMicProcessing } from '@/lib/translate-settings';

export const MIC_PROCESSING_STORAGE_KEY = 'chatofy.mic-processing';

/** Where an older build kept it, inside the whole local translate-settings object. */
const LEGACY_SETTINGS_KEY = 'chatofy.translate-settings';

const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The chain the old settings blob held, or undefined when it held none. */
function legacyMicProcessing(): unknown {
  const legacy = parseJson(readRaw(LEGACY_SETTINGS_KEY));
  return legacy && typeof legacy === 'object'
    ? (legacy as Record<string, unknown>).micProcessing
    : undefined;
}

/**
 * Memoised on the raw string, so `useSyncExternalStore` sees the same object until
 * the stored value actually changes — a fresh object per read would re-render
 * forever.
 */
let memo: { raw: string | null; legacy: string | null; value: MicProcessing } | null = null;

export function loadMicProcessing(): MicProcessing {
  if (typeof window === 'undefined') return DEFAULT_MIC_PROCESSING;
  const raw = readRaw(MIC_PROCESSING_STORAGE_KEY);
  const legacy = raw === null ? readRaw(LEGACY_SETTINGS_KEY) : null;
  if (memo && memo.raw === raw && memo.legacy === legacy) return memo.value;
  const value = parseMicProcessing(raw !== null ? parseJson(raw) : legacyMicProcessing());
  memo = { raw, legacy, value };
  return value;
}

export function saveMicProcessing(value: MicProcessing): void {
  try {
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Applied for this visit through the listeners below; it just will not outlive it.
  }
  for (const listener of listeners) listener();
}

/** This tab's writes, and another tab's through the `storage` event. */
export function subscribeMicProcessing(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === MIC_PROCESSING_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Copy the old blob's chain into its own key, once. Idempotent: a device that
 * already has the new key, or never had the old one, is left as it is.
 */
export function carryLegacyMicProcessing(): void {
  if (readRaw(MIC_PROCESSING_STORAGE_KEY) !== null) return;
  const legacy = legacyMicProcessing();
  if (legacy === undefined) return;
  try {
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, JSON.stringify(parseMicProcessing(legacy)));
  } catch {
    // Storage refused: the old blob stays readable until it can be written.
  }
}
