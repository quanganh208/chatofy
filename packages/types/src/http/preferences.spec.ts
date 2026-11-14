import { describe, expect, it } from 'vitest';
import {
  combinePreferencePatches,
  defaultUserPreferences,
  mergePreferences,
  parseUserPreferences,
  preferencesReadResponseSchema,
  preferencesResponseSchema,
  userPreferencesPatchSchema,
  userPreferencesSchema,
} from './preferences.js';

describe('defaultUserPreferences', () => {
  it('translates into the account language when it is a registry language', () => {
    const vi = defaultUserPreferences('vi');
    expect(vi.pairs.webOneWay).toEqual({ source: 'en', target: 'vi' });
    expect(vi.pairs.extension).toEqual({ source: 'en', target: 'vi' });
    expect(defaultUserPreferences('en').pairs.webTwoWay).toEqual({ source: 'vi', target: 'en' });
  });

  it('gives a Chinese account English into Chinese on every surface', () => {
    const zh = defaultUserPreferences('zh');
    expect(zh.pairs.webOneWay).toEqual({ source: 'en', target: 'zh' });
    expect(zh.pairs.extension).toEqual({ source: 'en', target: 'zh' });
    expect(userPreferencesSchema.safeParse(zh).success).toBe(true);
  });

  it('keeps the registry default for an unknown locale and follows the system theme', () => {
    const prefs = defaultUserPreferences('fr');
    expect(prefs.pairs.mobile).toEqual({ source: 'vi', target: 'en' });
    expect(prefs.theme).toBe('system');
    expect(userPreferencesSchema.safeParse(prefs).success).toBe(true);
  });
});

describe('parseUserPreferences', () => {
  const fallback = defaultUserPreferences('en');

  it('falls back one field at a time', () => {
    const parsed = parseUserPreferences(
      {
        theme: 'neon',
        voices: { en: { speed: 1.5 }, vi: { speed: 99 }, xx: { speak: false } },
        call: { captions: false, captionSize: 'huge' },
        pairs: {
          webTwoWay: { source: 'en', target: 'en' },
          extension: { source: 'en', target: 'vi' },
        },
      },
      fallback,
    );
    expect(parsed.theme).toBe('system');
    expect(parsed.voices).toEqual({ en: { speed: 1.5 } });
    expect(parsed.call).toEqual({ captions: false, captionSize: 'md', originalVolume: 1 });
    expect(parsed.pairs.webTwoWay).toEqual(fallback.pairs.webTwoWay);
    expect(parsed.pairs.extension).toEqual({ source: 'en', target: 'vi' });
  });

  it('returns the fallback for anything that is not an object', () => {
    expect(parseUserPreferences('x', fallback)).toBe(fallback);
    expect(parseUserPreferences(null, fallback)).toBe(fallback);
  });
});

describe('mergePreferences', () => {
  it('merges voices per language and per field without mutating', () => {
    const base = mergePreferences(defaultUserPreferences('en'), {
      voices: { en: { voice: 'af_heart', speed: 1 } },
    });
    const next = mergePreferences(base, { voices: { en: { speed: 1.25 }, vi: { speak: false } } });
    expect(next.voices).toEqual({ en: { voice: 'af_heart', speed: 1.25 }, vi: { speak: false } });
    expect(base.voices.en).toEqual({ voice: 'af_heart', speed: 1 });
  });

  it('sets nullable fields to null and leaves absent ones alone', () => {
    const base = mergePreferences(defaultUserPreferences('en'), { contextId: 'ctx-1' });
    expect(mergePreferences(base, {}).contextId).toBe('ctx-1');
    expect(mergePreferences(base, { contextId: null }).contextId).toBeNull();
  });

  it('merges pairs and call one level', () => {
    const next = mergePreferences(defaultUserPreferences('en'), {
      pairs: { mobile: { source: 'detect', target: 'en' } },
      call: { captionSize: 'xl' },
    });
    expect(next.pairs.mobile).toEqual({ source: 'detect', target: 'en' });
    expect(next.pairs.webOneWay).toEqual({ source: 'vi', target: 'en' });
    expect(next.call).toEqual({ captions: true, captionSize: 'xl', originalVolume: 1 });
  });
});

describe('combinePreferencePatches', () => {
  it('lets the later patch win per field at merge depth', () => {
    expect(
      combinePreferencePatches(
        { theme: 'dark', voices: { en: { speed: 1, voice: 'a' } }, call: { captions: false } },
        { voices: { en: { speed: 2 } }, call: { captionSize: 'lg' } },
      ),
    ).toEqual({
      theme: 'dark',
      voices: { en: { speed: 2, voice: 'a' } },
      call: { captions: false, captionSize: 'lg' },
    });
  });
});

describe('userPreferencesPatchSchema', () => {
  it('refuses unknown top-level keys and out-of-range values', () => {
    expect(userPreferencesPatchSchema.safeParse({ panelWidth: 300 }).success).toBe(false);
    expect(userPreferencesPatchSchema.safeParse({ voices: { en: { speed: 3 } } }).success).toBe(
      false,
    );
    expect(userPreferencesPatchSchema.safeParse({ theme: 'dark' }).success).toBe(true);
  });
});

describe('clearing a voice token', () => {
  it('removes the stored token on voice: null and keeps the other fields', () => {
    const base = mergePreferences(defaultUserPreferences('en'), {
      voices: { en: { voice: 'af_heart', gender: 'female', speed: 1.25 } },
    });
    const patch = userPreferencesPatchSchema.parse({
      voices: { en: { gender: 'male', voice: null } },
    });
    const next = mergePreferences(base, patch);
    expect(next.voices.en).toEqual({ gender: 'male', speed: 1.25 });
    expect(userPreferencesSchema.safeParse(next).success).toBe(true);
  });

  it('keeps the null through combining so a queued clear still reaches the server', () => {
    const combined = combinePreferencePatches(
      { voices: { en: { voice: null } } },
      { voices: { en: { speed: 2 } } },
    );
    expect(combined.voices?.en).toEqual({ voice: null, speed: 2 });
  });
});

describe('preferencesReadResponseSchema', () => {
  it("reads a newer build's document, leaving per-field tolerance to parseUserPreferences", () => {
    const newer = {
      ...defaultUserPreferences('en'),
      theme: 'sepia',
      voices: { ja: { speak: true } },
    };
    expect(
      preferencesResponseSchema.safeParse({ preferences: newer, updatedAt: 'v1' }).success,
    ).toBe(false);
    const read = preferencesReadResponseSchema.parse({ preferences: newer, updatedAt: 'v1' });
    const parsed = parseUserPreferences(read.preferences, defaultUserPreferences('en'));
    expect(parsed.theme).toBe('system');
  });
});
