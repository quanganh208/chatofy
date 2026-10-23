import { describe, expect, it } from 'vitest';
import { TurnSession } from '../session/turn-session';
import { restoreRequestFor } from './display-restore-request';

const session = (source: 'vi' | 'en', repairDisplay = true) =>
  new TurnSession({
    languagePair: { source, target: source === 'vi' ? 'en' : 'vi' },
    voiceGender: 'female',
    repairDisplay,
    hints: { hotwords: ['OpenAI'] },
  });

describe('restoreRequestFor', () => {
  it('asks for a display when the turn is recognised in a language written without marks', () => {
    expect(restoreRequestFor(session('vi'), undefined)).toEqual({
      terms: ['OpenAI'],
    });
    expect(restoreRequestFor(session('en'), undefined)).toBeUndefined();
  });

  it('restores a turn decided in Vietnamese whose provisional language was English', () => {
    // A two-way turn's plan says English until it is decided; the request is
    // made for the language it was decided in.
    expect(restoreRequestFor(session('en'), 'trước đó', [], 'vi')).toEqual({
      context: 'trước đó',
      terms: ['OpenAI'],
    });
  });

  it('asks nothing of a client that renders the raw transcript', () => {
    expect(
      restoreRequestFor(session('vi', false), undefined, [], 'vi'),
    ).toBeUndefined();
  });
});
