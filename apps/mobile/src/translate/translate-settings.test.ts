import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  parseTranslateSettings,
  withVoiceGender,
} from './translate-settings.ts';

describe('parseTranslateSettings', () => {
  it('falls back to the defaults for anything that is not an object', () => {
    for (const raw of [null, undefined, 'x', 3, []]) {
      assert.deepEqual(parseTranslateSettings(raw).pair, DEFAULT_TRANSLATE_SETTINGS.pair);
    }
  });

  it('keeps a valid stored value', () => {
    const settings = parseTranslateSettings({
      pair: { source: 'detect', target: 'en' },
      speak: false,
      voiceGender: 'male',
      voices: { en: 'voice-1', vi: 'voice-2' },
    });
    assert.deepEqual(settings, {
      pair: { source: 'detect', target: 'en' },
      speak: false,
      voiceGender: 'male',
      voices: { en: 'voice-1', vi: 'voice-2' },
    });
  });

  it('drops each field it cannot represent without discarding the rest', () => {
    const settings = parseTranslateSettings({
      pair: { source: 'klingon', target: 'en' },
      speak: 'yes',
      voiceGender: 'robot',
      voices: { en: 'x'.repeat(65), vi: '', fr: 'nope', zh: 'ok' },
    });
    assert.deepEqual(settings.pair, DEFAULT_TRANSLATE_SETTINGS.pair);
    assert.equal(settings.speak, true);
    assert.equal(settings.voiceGender, DEFAULT_TRANSLATE_SETTINGS.voiceGender);
    assert.deepEqual(settings.voices, { zh: 'ok' });
  });

  it('repairs a pair the picker cannot hold', () => {
    // Auto-detect into Chinese-only candidates would be fine; a same-language pair is not.
    const settings = parseTranslateSettings({ pair: { source: 'en', target: 'en' } });
    assert.notEqual(settings.pair.source, settings.pair.target);
  });
});

describe('withVoiceGender', () => {
  const settings = {
    ...DEFAULT_TRANSLATE_SETTINGS,
    voiceGender: 'female' as const,
    voices: { en: 'voice-1' },
  };

  it('drops chosen voices when the gender changes', () => {
    assert.deepEqual(withVoiceGender(settings, 'male'), {
      ...settings,
      voiceGender: 'male',
      voices: {},
    });
  });

  it('keeps them when the same gender is picked again', () => {
    assert.equal(withVoiceGender(settings, 'female'), settings);
  });
});
