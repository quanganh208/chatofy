import { DEFAULT_MIC_PROCESSING } from '@chatofy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { PREFERENCES_KEY } from './preferences-cache';
import { defaultUserPreferences } from '@chatofy/types';
import { dropLegacySyncedSettings, loadSettings, saveSettings } from './settings';

/**
 * `settings.ts` is the only module under `src/` that reaches for a Chrome API
 * directly, so the store is stubbed here rather than injected. A whole fake
 * `chrome` would be more than these two functions read: they use one area and two
 * of its methods, and a stub that narrow fails loudly if that ever widens.
 */
const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
        remove: (key: string) => {
          store.delete(key);
          return Promise.resolve();
        },
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
          return Promise.resolve();
        },
      },
    },
  };
});

const KEY = 'chatofy.settings';
const VI_TO_EN = { source: 'vi', target: 'en' } as const;

describe('loadSettings', () => {
  // `mode` named a second translation backend that no longer exists. It is
  // dropped on load so the next save does not write it back.
  it('drops a mode stored by an older build', async () => {
    store.set(KEY, { languagePair: VI_TO_EN, mode: 'live' });
    const settings = await loadSettings();
    expect(settings).not.toHaveProperty('mode');
    await saveSettings(settings);
    expect(store.get(KEY)).not.toHaveProperty('mode');
  });

  // The field the popup used to expose is gone, so the build owns this value. A
  // profile that saved a development host while the field existed would otherwise
  // keep pointing there with nothing on screen to change it.
  it('ignores a stored apiBaseUrl', async () => {
    store.set(KEY, { apiBaseUrl: 'http://stale.example:9999' });
    expect((await loadSettings()).apiBaseUrl).not.toBe('http://stale.example:9999');
  });

  it('still merges the settings this machine owns', async () => {
    store.set(KEY, { outbound: true, reportMetrics: true });
    const settings = await loadSettings();
    expect(settings.outbound).toBe(true);
    expect(settings.reportMetrics).toBe(true);
  });

  it('fills every field when nothing has been stored', async () => {
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual({ source: 'en', target: 'vi' });
    expect(settings.voiceGender).toBeDefined();
    expect(settings.apiBaseUrl).toMatch(/^https?:\/\//);
    expect(settings.outbound).toBe(false);
    expect(settings.contextId).toBeUndefined();
  });

  // The pair, the voice and the context are the account's. A value an older build
  // left in the local object is not imported, so it cannot be mistaken for one
  // the account chose.
  it('does not read the synced fields from the local object', async () => {
    store.set(KEY, {
      languagePair: VI_TO_EN,
      voiceGender: 'male',
      contextId: 'old',
      direction: 'zh_to_en',
    });
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual({ source: 'en', target: 'vi' });
    expect(settings.voiceGender).toBe('female');
    expect(settings.contextId).toBeUndefined();
  });

  it('reads the pair, voice and context from the cached account preferences', async () => {
    const prefs = defaultUserPreferences('en');
    store.set(PREFERENCES_KEY, {
      ...prefs,
      contextId: 'ctx-1',
      pairs: { ...prefs.pairs, extension: VI_TO_EN },
      voices: { en: { gender: 'male' } },
    });
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual(VI_TO_EN);
    expect(settings.voiceGender).toBe('male');
    expect(settings.contextId).toBe('ctx-1');
  });

  const ALL_ON = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  it('turns every mic processing switch on when nothing has been stored', async () => {
    expect((await loadSettings()).micProcessing).toEqual(ALL_ON);
  });

  // One stored switch must not cost the others their defaults.
  it('keeps a stored mic processing switch and defaults the missing ones', async () => {
    store.set(KEY, { micProcessing: { noiseSuppression: false } });
    expect((await loadSettings()).micProcessing).toEqual({ ...ALL_ON, noiseSuppression: false });
  });

  it('falls back to the mic processing defaults for a malformed value', async () => {
    store.set(KEY, { micProcessing: 'x' });
    expect((await loadSettings()).micProcessing).toEqual(ALL_ON);
  });
});

describe('saveSettings', () => {
  // The parameter type no longer accepts the field, so the interesting assertion is
  // about what reaches storage: nothing should reintroduce a key that loadSettings
  // ignores and no surface can edit.
  /**
   * Built the way the real callers build it — by spreading a loaded settings object
   * — and not as a literal without the field.
   *
   * A literal cannot fail this assertion whatever `saveSettings` does, because the
   * key was never in the input. Both real callers spread, TypeScript does not
   * excess-property-check a spread, and that combination is exactly how the strip
   * went missing once already while this test stayed green.
   */
  it('does not persist apiBaseUrl, even when the caller passes one', async () => {
    const loaded = await loadSettings();
    expect(loaded).toHaveProperty('apiBaseUrl');
    await saveSettings({ ...loaded, outbound: true });
    expect(store.get(KEY)).not.toHaveProperty('apiBaseUrl');
  });

  // Same spread, same blind spot: the account's fields must not ride along into
  // this machine's object either.
  it('does not persist the synced fields, even when the caller spreads them in', async () => {
    const loaded = await loadSettings();
    await saveSettings({ ...loaded, contextId: 'ctx-123' } as Parameters<typeof saveSettings>[0]);
    expect(Object.keys(store.get(KEY) as object).sort()).toEqual([
      'micProcessing',
      'outbound',
      'reportMetrics',
    ]);
  });

  it('round-trips the settings this machine owns', async () => {
    await saveSettings({
      reportMetrics: true,
      outbound: true,
      micProcessing: DEFAULT_MIC_PROCESSING,
    });
    const settings = await loadSettings();
    expect(settings.reportMetrics).toBe(true);
    expect(settings.outbound).toBe(true);
  });
});

describe('dropLegacySyncedSettings', () => {
  it('removes the fields the account owns and keeps the rest', async () => {
    store.set(KEY, {
      languagePair: VI_TO_EN,
      voiceGender: 'male',
      contextId: 'x',
      direction: 'a',
      mode: 'b',
      outbound: true,
    });
    await dropLegacySyncedSettings();
    expect(store.get(KEY)).toEqual({ outbound: true });
  });

  it('does nothing when nothing is stored', async () => {
    await dropLegacySyncedSettings();
    expect(store.has(KEY)).toBe(false);
  });
});
