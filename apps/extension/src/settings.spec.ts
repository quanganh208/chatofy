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
});

describe('saveSettings', () => {
  it('does not persist apiBaseUrl', async () => {
    await saveSettings({
      direction: 'en_to_vi',
      mode: 'cascade',
      voiceGender: 'female',
      apiBaseUrl: 'http://localhost:3000',
      reportMetrics: false,
      outbound: false,
    });
    expect(store.get(KEY)).not.toHaveProperty('apiBaseUrl');
  });

  it('round-trips the settings a user does control', async () => {
    await saveSettings({
      direction: 'vi_to_en',
      mode: 'cascade',
      voiceGender: 'male',
      apiBaseUrl: 'http://localhost:3000',
      reportMetrics: true,
      outbound: true,
    });
    const settings = await loadSettings();
    expect(settings.direction).toBe('vi_to_en');
    expect(settings.voiceGender).toBe('male');
    expect(settings.reportMetrics).toBe(true);
    expect(settings.outbound).toBe(true);
  });
});
