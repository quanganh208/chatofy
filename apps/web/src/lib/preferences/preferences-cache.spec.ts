// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultUserPreferences } from '@chatofy/types';
import { MIC_PROCESSING_STORAGE_KEY } from '@/lib/mic-processing-store';
import {
  LEGACY_PREFERENCE_KEYS,
  PREFERENCES_CACHE_KEY,
  accountPreferencesCache,
  cachedUserId,
  forgetAccountPreferences,
  readCachedTheme,
  removeLegacyPreferenceKeys,
  writeVisitorTheme,
} from './preferences-cache';

const DOC = { ...defaultUserPreferences('en'), theme: 'dark' as const };
const raw = () => JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY) ?? 'null') as unknown;

beforeEach(() => localStorage.clear());

describe('the preferences cache', () => {
  it("serves one account's copy to that account only", () => {
    // On a shared browser the last person's setup is not the next person's.
    void accountPreferencesCache('user-a').write(DOC);
    expect(accountPreferencesCache('user-a').read()).toEqual(DOC);
    expect(accountPreferencesCache('user-b').read()).toBeNull();
    expect(cachedUserId()).toBe('user-a');
  });

  it('keeps the theme, and only the theme, when the account is forgotten', () => {
    void accountPreferencesCache('user-a').write(DOC);
    forgetAccountPreferences();
    expect(raw()).toEqual({ userId: null, preferences: { theme: 'dark' } });
    expect(accountPreferencesCache('user-a').read()).toBeNull();
    expect(readCachedTheme()).toBe('dark');
  });

  it("never lets a visitor's theme into an account", () => {
    writeVisitorTheme('light');
    expect(readCachedTheme()).toBe('light');
    expect(cachedUserId()).toBeNull();
    expect(accountPreferencesCache('user-a').read()).toBeNull();
  });

  it('reads anything unreadable as no cache and the machine theme', () => {
    for (const value of ['{not json', '7', JSON.stringify({ userId: 3, preferences: 'x' })]) {
      localStorage.setItem(PREFERENCES_CACHE_KEY, value);
      expect(readCachedTheme()).toBe('system');
      expect(cachedUserId()).toBeNull();
    }
  });
});

describe('unsent changes', () => {
  it('are kept under their account, beside the document, and survive its next write', () => {
    const cache = accountPreferencesCache('user-a');
    void cache.write(DOC);
    void cache.writePending!({ contexts: { tab: { theme: 'light' } } });
    void cache.write({ ...DOC, translateMode: 'two-way' });
    expect(cache.readPending!()).toEqual({ contexts: { tab: { theme: 'light' } } });
    expect(cache.read()).toMatchObject({ translateMode: 'two-way' });
    expect(accountPreferencesCache('user-b').readPending!()).toBeNull();
  });

  it('are kept even before the document is, and cleared on null', () => {
    const cache = accountPreferencesCache('user-a');
    void cache.writePending!({ contexts: { tab: { theme: 'light' } } });
    expect(cache.readPending!()).toEqual({ contexts: { tab: { theme: 'light' } } });
    expect(cache.read()).toBeNull();
    void cache.write(DOC);
    void cache.writePending!(null);
    expect(cache.readPending!()).toBeNull();
    expect(cache.read()).toEqual(DOC);
  });

  it('are forgotten with the account on sign-out', () => {
    const cache = accountPreferencesCache('user-a');
    void cache.write(DOC);
    void cache.writePending!({ contexts: { tab: { translateMode: 'two-way' } } });
    forgetAccountPreferences();
    expect(raw()).toEqual({ userId: null, preferences: { theme: 'dark' } });
  });
});

describe('removing the keys preferences used to live in', () => {
  it('removes every one, carrying the microphone chain across first', () => {
    for (const key of LEGACY_PREFERENCE_KEYS) localStorage.setItem(key, '"x"');
    localStorage.setItem(
      'chatofy.translate-settings',
      JSON.stringify({ micProcessing: { noiseSuppression: false } }),
    );
    localStorage.setItem('chatofy.sidebar-width', '300');

    removeLegacyPreferenceKeys();

    for (const key of LEGACY_PREFERENCE_KEYS) expect(localStorage.getItem(key), key).toBeNull();
    expect(JSON.parse(localStorage.getItem(MIC_PROCESSING_STORAGE_KEY)!)).toMatchObject({
      noiseSuppression: false,
    });
    // Panel widths are the screen's, not the person's: they stay.
    expect(localStorage.getItem('chatofy.sidebar-width')).toBe('300');
  });

  it('is safe to run again', () => {
    removeLegacyPreferenceKeys();
    expect(() => removeLegacyPreferenceKeys()).not.toThrow();
  });
});
