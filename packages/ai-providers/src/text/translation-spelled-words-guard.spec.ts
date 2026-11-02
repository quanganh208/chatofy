import { describe, expect, it } from 'vitest';

import { keepWhatTheTranslationSpelled } from './translation-spelled-words-guard.js';

describe('keepWhatTheTranslationSpelled', () => {
  it('keeps a name the translation spelled as heard', () => {
    // Heard on prod: the fusion took the second recognizer's "thì minh" while
    // the same turn's translation said "Thuy Minh".
    const thi = { heard: 'thùy', said: 'thì', at: 3 };
    expect(
      keepWhatTheTranslationSpelled(
        'những khách mời thùy minh cũng là',
        [thi],
        ["The guests on Thuy Minh's show are also figures"],
      ),
    ).toEqual([]);
  });

  it('keeps a correction the translation does not contradict', () => {
    const dao = { heard: 'giao', said: 'dao', at: 3 };
    expect(
      keepWhatTheTranslationSpelled(
        'một vụ đâm giao nghiêm trọng',
        [dao],
        ['A serious stabbing took place'],
      ),
    ).toEqual([dao]);
  });

  it('keeps a correction the translation spelled as said', () => {
    const fix = { heard: 'roman', said: 'rumen', at: 2 };
    expect(
      keepWhatTheTranslationSpelled(
        'tổng thống roman radev',
        [fix],
        ['President Rumen Radev, not Roman'],
      ),
    ).toEqual([fix]);
  });

  it('does not protect a single short word an English sentence happens to contain', () => {
    const fix = { heard: 'an', said: 'ăn', at: 1 };
    expect(keepWhatTheTranslationSpelled('tôi an cơm', [fix], ['I eat an apple'])).toEqual([fix]);
  });

  it('changes nothing with no translation', () => {
    const thi = { heard: 'thùy', said: 'thì', at: 3 };
    expect(keepWhatTheTranslationSpelled('những khách mời thùy minh', [thi], [])).toEqual([thi]);
  });
});
