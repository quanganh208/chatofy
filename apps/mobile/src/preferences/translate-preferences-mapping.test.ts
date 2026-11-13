import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultUserPreferences, mergePreferences } from '@chatofy/types';
import { patchFromSettings, settingsFromPreferences } from './translate-preferences-mapping.ts';

const MIC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const base = () => defaultUserPreferences('vi');

describe('settingsFromPreferences', () => {
  it('reads the phone pair and keeps the device microphone', () => {
    const prefs = mergePreferences(base(), {
      pairs: { mobile: { source: 'detect', target: 'zh' } },
    });
    const settings = settingsFromPreferences(prefs, MIC);
    assert.deepEqual(settings.pair, { source: 'detect', target: 'zh' });
    assert.deepEqual(settings.micProcessing, MIC);
  });

  it('reads speak and gender from the language spoken aloud, the pair target', () => {
    const prefs = mergePreferences(base(), {
      pairs: { mobile: { source: 'vi', target: 'en' } },
      voices: { en: { speak: false, gender: 'male' }, vi: { speak: true, gender: 'female' } },
    });
    const settings = settingsFromPreferences(prefs, MIC);
    assert.equal(settings.speak, false);
    assert.equal(settings.voiceGender, 'male');
  });

  it('maps each language voice token and ignores languages without one', () => {
    const prefs = mergePreferences(base(), {
      voices: { en: { voice: 'en-1' }, zh: { speed: 1.5 } },
    });
    assert.deepEqual(settingsFromPreferences(prefs, MIC).voices, { en: 'en-1' });
  });

  it('falls back to the settings defaults when the target has no entry', () => {
    const settings = settingsFromPreferences(base(), MIC);
    assert.equal(settings.speak, true);
  });
});

describe('patchFromSettings', () => {
  const previous = settingsFromPreferences(base(), MIC);

  it('is null when only the microphone changed', () => {
    const next = { ...previous, micProcessing: { ...MIC, echoCancellation: true } };
    assert.equal(patchFromSettings(previous, next), null);
  });

  it('names only the pair for a pair change', () => {
    const next = { ...previous, pair: { source: 'vi', target: 'en' } as const };
    assert.deepEqual(patchFromSettings(previous, next), {
      pairs: { mobile: { source: 'vi', target: 'en' } },
    });
  });

  it('writes speak and gender against the next pair target', () => {
    const next = {
      ...previous,
      pair: { source: 'en', target: 'zh' } as const,
      speak: false,
      voiceGender: 'male' as const,
    };
    assert.deepEqual(patchFromSettings(previous, next), {
      pairs: { mobile: { source: 'en', target: 'zh' } },
      voices: { zh: { speak: false, gender: 'male' } },
    });
  });

  it('merges a voice token into the same language entry', () => {
    const next = { ...previous, speak: false, voices: { [previous.pair.target]: 'tok' } };
    const patch = patchFromSettings(previous, next);
    assert.deepEqual(patch?.voices?.[previous.pair.target], { speak: false, voice: 'tok' });
  });

  it('sends null for a voice the settings dropped', () => {
    const had = { ...previous, voices: { en: 'en-1', zh: 'zh-1' } };
    const next = { ...had, voiceGender: 'male' as const, voices: {} };
    const patch = patchFromSettings(had, next);
    assert.equal(patch?.voices?.en?.voice, null);
    assert.equal(patch?.voices?.zh?.voice, null);
    const cleared = mergePreferences(
      mergePreferences(base(), { voices: { en: { voice: 'en-1' } } }),
      patch ?? {},
    );
    assert.equal(cleared.voices.en?.voice, undefined);
    assert.equal(JSON.parse(JSON.stringify(patch)).voices.en.voice, null);
  });

  it('round-trips through the document', () => {
    const next = {
      ...previous,
      pair: { source: 'detect', target: 'en' } as const,
      speak: false,
      voices: { en: 'en-7' },
    };
    const patch = patchFromSettings(previous, next);
    assert.ok(patch);
    const again = settingsFromPreferences(mergePreferences(base(), patch), MIC);
    assert.deepEqual(again.pair, next.pair);
    assert.equal(again.speak, false);
    assert.deepEqual(again.voices, { en: 'en-7' });
  });

  it('does not touch fields it does not own', () => {
    const next = { ...previous, speak: false };
    const merged = mergePreferences(base(), patchFromSettings(previous, next) ?? {});
    assert.deepEqual(merged.pairs.webOneWay, base().pairs.webOneWay);
    assert.equal(merged.theme, 'system');
  });
});
