import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOICE_GENDER } from '@chatofy/types/domain';
import { parseVoiceGenderParam } from './conference-voice-param.ts';

describe('parseVoiceGenderParam', () => {
  it('keeps a gender the lobby chose', () => {
    assert.equal(parseVoiceGenderParam('male'), 'male');
    assert.equal(parseVoiceGenderParam('female'), 'female');
  });

  it('falls back to the default when nothing was passed', () => {
    assert.equal(parseVoiceGenderParam(undefined), DEFAULT_VOICE_GENDER);
  });

  it('falls back to the default for a value it does not know', () => {
    assert.equal(parseVoiceGenderParam('robot'), DEFAULT_VOICE_GENDER);
  });
});
