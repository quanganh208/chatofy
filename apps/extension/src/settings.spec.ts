import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from './settings';
import type { CaptureSettings } from './messages';

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

describe('loadSettings', () => {
  it('reads a stored live mode back as the cascade', async () => {
    store.set(KEY, { mode: 'live' } satisfies Partial<CaptureSettings>);
    expect((await loadSettings()).mode).toBe('cascade');
  });

  // The popup no longer offers the choice, so there is no surface left to leave a
  // stored mode by. Coercing only the one mode that was removed would let a
  // corrupt value — or a mode added later and rolled back — pin a profile the same
  // way. Anything that is not the cascade is read as the cascade.
  it('reads any non-cascade mode back as the cascade', async () => {
    for (const mode of ['live', 'gibberish', '', null, undefined]) {
      store.set(KEY, { mode });
      expect((await loadSettings()).mode).toBe('cascade');
    }
  });

  it('keeps a stored cascade', async () => {
    store.set(KEY, { mode: 'cascade' });
    expect((await loadSettings()).mode).toBe('cascade');
  });

  // The field the popup used to expose is gone, so the build owns this value. A
  // profile that saved a development host while the field existed would otherwise
  // keep pointing there with nothing on screen to change it.
  it('ignores a stored apiBaseUrl', async () => {
    store.set(KEY, { apiBaseUrl: 'http://stale.example:9999' });
    expect((await loadSettings()).apiBaseUrl).not.toBe('http://stale.example:9999');
  });

  it('still merges the settings a user does control', async () => {
    store.set(KEY, { direction: 'vi_to_en', outbound: true });
    const settings = await loadSettings();
    expect(settings.direction).toBe('vi_to_en');
    expect(settings.outbound).toBe(true);
  });

  it('fills every field when nothing has been stored', async () => {
    const settings = await loadSettings();
    expect(settings.direction).toBe('en_to_vi');
    expect(settings.voiceGender).toBeDefined();
    expect(settings.apiBaseUrl).toMatch(/^https?:\/\//);
    expect(settings.outbound).toBe(false);
  });

  // A stale id is harmless — it resolves to nothing where the list is fetched —
  // so unlike `mode` and `apiBaseUrl` it is not whitelisted away. This is the
  // load half of that: nothing here should reject or rewrite it.
  it('a stored object with no contextId loads', async () => {
    store.set(KEY, { direction: 'vi_to_en' });
    const settings = await loadSettings();
    expect(settings.contextId).toBeUndefined();
    expect(settings.direction).toBe('vi_to_en');
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
    await saveSettings({ ...loaded, direction: 'vi_to_en' });
    expect(store.get(KEY)).not.toHaveProperty('apiBaseUrl');
  });

  it('round-trips the settings a user does control', async () => {
    await saveSettings({
      direction: 'vi_to_en',
      mode: 'cascade',
      voiceGender: 'male',
      reportMetrics: true,
      outbound: true,
    });
    const settings = await loadSettings();
    expect(settings.direction).toBe('vi_to_en');
    expect(settings.voiceGender).toBe('male');
    expect(settings.reportMetrics).toBe(true);
    expect(settings.outbound).toBe(true);
  });

  it('a contextId survives the round-trip', async () => {
    await saveSettings({
      direction: 'en_to_vi',
      mode: 'cascade',
      voiceGender: 'female',
      reportMetrics: false,
      outbound: false,
      contextId: 'ctx-123',
    });
    expect((await loadSettings()).contextId).toBe('ctx-123');
  });
});
