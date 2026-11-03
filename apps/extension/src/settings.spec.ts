import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from './settings';

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

  it('still merges the settings a user does control', async () => {
    store.set(KEY, { languagePair: VI_TO_EN, outbound: true });
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual(VI_TO_EN);
    expect(settings.outbound).toBe(true);
  });

  it('fills every field when nothing has been stored', async () => {
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual({ source: 'en', target: 'vi' });
    expect(settings.voiceGender).toBeDefined();
    expect(settings.apiBaseUrl).toMatch(/^https?:\/\//);
    expect(settings.outbound).toBe(false);
  });

  // A stale id is harmless — it resolves to nothing where the list is fetched —
  // so unlike `apiBaseUrl` it is not whitelisted away. This is the
  // load half of that: nothing here should reject or rewrite it.
  it('a stored object with no contextId loads', async () => {
    store.set(KEY, { languagePair: VI_TO_EN });
    const settings = await loadSettings();
    expect(settings.contextId).toBeUndefined();
    expect(settings.languagePair).toEqual(VI_TO_EN);
  });

  // Builds before the pair stored a `direction` string. A profile that chose its
  // languages then must keep them rather than reopening on the default.
  it('reads a pre-pair stored direction as its language pair', async () => {
    store.set(KEY, { direction: 'zh_to_en', outbound: true });
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual({ source: 'zh', target: 'en' });
    expect(settings.outbound).toBe(true);
  });

  it('does not carry the pre-pair key into what the next save writes', async () => {
    store.set(KEY, { direction: 'vi_to_en' });
    await saveSettings(await loadSettings());
    expect(store.get(KEY)).not.toHaveProperty('direction');
    expect(store.get(KEY)).toMatchObject({ languagePair: VI_TO_EN });
  });

  it('prefers a stored pair over a leftover direction', async () => {
    store.set(KEY, { languagePair: VI_TO_EN, direction: 'en_to_zh' });
    expect((await loadSettings()).languagePair).toEqual(VI_TO_EN);
  });

  it('falls back to the default for a malformed pair or direction', async () => {
    for (const stored of [
      { languagePair: { source: 'vi', target: 'vi' } },
      { languagePair: { source: 'xx', target: 'en' } },
      { languagePair: 'vi_to_en' },
      { direction: 'vi_to_vi' },
      { direction: 42 },
    ]) {
      store.set(KEY, stored);
      expect((await loadSettings()).languagePair).toEqual({ source: 'en', target: 'vi' });
    }
  });

  it('contextId is not stripped by the whitelist', async () => {
    store.set(KEY, { contextId: 'some-old-context-id' });
    expect((await loadSettings()).contextId).toBe('some-old-context-id');
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
    await saveSettings({ ...loaded, languagePair: VI_TO_EN });
    expect(store.get(KEY)).not.toHaveProperty('apiBaseUrl');
  });

  it('round-trips the settings a user does control', async () => {
    await saveSettings({
      languagePair: VI_TO_EN,
      voiceGender: 'male',
      reportMetrics: true,
      outbound: true,
    });
    const settings = await loadSettings();
    expect(settings.languagePair).toEqual(VI_TO_EN);
    expect(settings.voiceGender).toBe('male');
    expect(settings.reportMetrics).toBe(true);
    expect(settings.outbound).toBe(true);
  });

  it('a contextId survives the round-trip', async () => {
    await saveSettings({
      languagePair: { source: 'en', target: 'vi' },
      voiceGender: 'female',
      reportMetrics: false,
      outbound: false,
      contextId: 'ctx-123',
    });
    expect((await loadSettings()).contextId).toBe('ctx-123');
  });
});
