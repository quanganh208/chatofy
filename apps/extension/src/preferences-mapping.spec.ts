import { defaultUserPreferences, languagePairOf, type UserPreferences } from '@chatofy/types';
import { describe, expect, it } from 'vitest';
import { patchFromSynced, syncedFieldsOf } from './preferences-mapping';

const base = (): UserPreferences => {
  const prefs = defaultUserPreferences('en');
  return { ...prefs, pairs: { ...prefs.pairs, extension: languagePairOf('en', 'vi') } };
};

describe('syncedFieldsOf', () => {
  it('reads the extension pair, the target language voice and the context', () => {
    const prefs: UserPreferences = {
      ...base(),
      contextId: 'ctx-1',
      voices: { vi: { gender: 'male' }, en: { gender: 'female' } },
    };
    expect(syncedFieldsOf(prefs)).toEqual({
      languagePair: { source: 'en', target: 'vi' },
      voiceGender: 'male',
      contextId: 'ctx-1',
    });
  });

  it('falls back to the default voice and no context', () => {
    const fields = syncedFieldsOf(base());
    expect(fields.voiceGender).toBe('female');
    expect(fields.contextId).toBeUndefined();
  });
});

describe('patchFromSynced', () => {
  it('writes a changed pair to the extension surface only', () => {
    expect(patchFromSynced(base(), { languagePair: languagePairOf('vi', 'en') })).toEqual({
      pairs: { extension: { source: 'vi', target: 'en' } },
    });
  });

  it('writes a gender against the target of the pair being set', () => {
    expect(
      patchFromSynced(base(), { languagePair: languagePairOf('vi', 'en'), voiceGender: 'male' }),
    ).toEqual({
      pairs: { extension: { source: 'vi', target: 'en' } },
      voices: { en: { gender: 'male' } },
    });
  });

  // The overlay repeats the old gender beside a new pair; that must not copy the
  // old target's voice onto the new one.
  it('leaves voices alone when the gender equals what is stored now', () => {
    const prefs: UserPreferences = { ...base(), voices: { vi: { gender: 'male' } } };
    expect(
      patchFromSynced(prefs, { languagePair: languagePairOf('vi', 'en'), voiceGender: 'male' }),
    ).toEqual({ pairs: { extension: { source: 'vi', target: 'en' } } });
    expect(patchFromSynced(prefs, { voiceGender: 'male' })).toBeNull();
  });

  it('sets and clears the context', () => {
    expect(patchFromSynced(base(), { contextId: 'ctx-1' })).toEqual({ contextId: 'ctx-1' });
    const withContext: UserPreferences = { ...base(), contextId: 'ctx-1' };
    expect(patchFromSynced(withContext, { contextId: undefined })).toEqual({ contextId: null });
    expect(patchFromSynced(withContext, { contextId: 'ctx-1' })).toBeNull();
  });

  it('returns null when nothing changes', () => {
    expect(patchFromSynced(base(), {})).toBeNull();
    expect(patchFromSynced(base(), { languagePair: languagePairOf('en', 'vi') })).toBeNull();
  });
});
