import { describe, expect, it } from 'vitest';
import {
  acceptHomophoneRepairs,
  MAX_REPAIRS_PER_TRANSCRIPT,
  soundKey,
  soundsAlike,
} from './vietnamese-homophones.js';

describe('soundKey', () => {
  it.each([
    ['dao', 'giao'],
    ['dao', 'rao'],
    ['triều', 'chiều'],
    ['sổ', 'xổ'],
    ['đinh', 'đỉnh'],
    ['và', 'vạ'],
    ['bàn', 'bàng'],
    ['mát', 'mác'],
    ['kẻ', 'cẻ'],
    ['gì', 'dì'],
  ])('hears %s and %s alike', (a, b) => {
    expect(soundKey(a)).not.toBeNull();
    expect(soundKey(a)).toBe(soundKey(b));
  });

  it.each([
    ['dao', 'đao'],
    ['về', 'với'],
    ['dễ', 'sẽ'],
    ['vuốt', 'tuột'],
    ['kiềm', 'kiểng'],
    ['lan', 'nan'],
  ])('tells %s from %s', (a, b) => {
    expect(soundKey(a)).not.toBe(soundKey(b));
  });

  it('has no key for a word that cannot be a syllable', () => {
    expect(soundKey('bulgaria')).toBeNull();
    expect(soundKey('12')).toBeNull();
  });
});

describe('soundsAlike', () => {
  it.each([
    ['giao', 'dao'],
    ['chiều', 'triều'],
    ['đinh', 'đỉnh'],
    ['vươn', 'vườn'],
    ['vạ', 'và'],
  ])('lets %s be heard as %s: one difference', (was, said) => {
    expect(soundsAlike(was, said)).toBe(true);
  });

  it.each([
    // Onset and coda and tone: the north's merger, the south's, and a tone.
    ['rán', 'giáng'],
    // Onset and tone.
    ['chiều', 'triệu'],
    ['dễ', 'sẽ'],
  ])('refuses %s for %s', (was, said) => {
    expect(soundsAlike(was, said)).toBe(false);
  });
});

describe('acceptHomophoneRepairs', () => {
  const transcript = 'một vụ đâm giao nghiêm trọng đã xảy ra';

  it('accepts a word that sounds like the one heard, at the place it was heard', () => {
    expect(acceptHomophoneRepairs(transcript, [{ heard: 'đâm giao', said: 'đâm dao' }])).toEqual([
      { heard: 'đâm giao', said: 'đâm dao', at: 2 },
    ]);
  });

  it('reads case and marks the same as the transcript', () => {
    expect(
      acceptHomophoneRepairs('Chiều cường lên cao', [
        { heard: 'chiều cường', said: 'Triều cường' },
      ]),
    ).toEqual([{ heard: 'chiều cường', said: 'triều cường', at: 0 }]);
  });

  it('refuses a word that does not sound like the one heard', () => {
    // A rewrite of meaning, however plausible: the model may only fix hearing.
    expect(acceptHomophoneRepairs(transcript, [{ heard: 'đâm giao', said: 'đâm chém' }])).toEqual(
      [],
    );
  });

  it('refuses words that are not in the transcript', () => {
    expect(acceptHomophoneRepairs(transcript, [{ heard: 'giao hàng', said: 'dao hàng' }])).toEqual(
      [],
    );
    // Whole words only: "giao" inside another word is not the word "giao".
    expect(acceptHomophoneRepairs('giaothông', [{ heard: 'giao', said: 'dao' }])).toEqual([]);
  });

  it('refuses words heard in two places, since it cannot say which one was misheard', () => {
    // One misheard "giao", one right one: repairing both breaks "giao hàng".
    const line = 'đâm giao rồi giao hàng';
    expect(acceptHomophoneRepairs(line, [{ heard: 'giao', said: 'dao' }])).toEqual([]);
    // Named with its neighbour, the place is one again.
    expect(acceptHomophoneRepairs(line, [{ heard: 'đâm giao', said: 'đâm dao' }])).toEqual([
      { heard: 'đâm giao', said: 'đâm dao', at: 0 },
    ]);
  });

  it('refuses a repair that adds or drops a word', () => {
    expect(
      acceptHomophoneRepairs(transcript, [{ heard: 'đâm giao', said: 'đâm con dao' }]),
    ).toEqual([]);
  });

  it('refuses a run longer than three words', () => {
    expect(
      acceptHomophoneRepairs(transcript, [{ heard: 'một vụ đâm giao', said: 'một vụ đâm dao' }]),
    ).toEqual([]);
  });

  it('refuses a foreign word, which is the respelling path', () => {
    expect(
      acceptHomophoneRepairs('thủ tướng bulgari cho biết', [
        { heard: 'bulgari', said: 'bulgaria' },
      ]),
    ).toEqual([]);
  });

  it('never changes a quantity, in digits or in words', () => {
    expect(acceptHomophoneRepairs('tầng hai', [{ heard: 'hai', said: '2' }])).toEqual([]);
    // The ITN would print "3 triệu" for a film "ba chiều".
    expect(acceptHomophoneRepairs('phim ba chiều', [{ heard: 'chiều', said: 'triệu' }])).toEqual(
      [],
    );
    expect(
      acceptHomophoneRepairs('hai mươi người', [{ heard: 'hai mươi', said: 'hai mười' }]),
    ).toEqual([]);
  });

  it('ignores a proposal that changes nothing, or is not a pair of strings', () => {
    expect(
      acceptHomophoneRepairs(transcript, [
        { heard: 'đâm giao', said: 'đâm giao' },
        { heard: 'giao' },
        null,
      ]),
    ).toEqual([]);
    expect(acceptHomophoneRepairs(transcript, ['giao -> dao', { heard: 1, said: 2 }])).toEqual([]);
  });

  it('keeps the first of two repairs of the same words', () => {
    // Composed, "a b" -> "x b" and "b c" -> "b z" would print "x z", which
    // neither proposed.
    expect(
      acceptHomophoneRepairs('đâm giao động mạnh', [
        { heard: 'đâm giao', said: 'đâm dao' },
        { heard: 'giao động', said: 'rao động' },
      ]),
    ).toEqual([{ heard: 'đâm giao', said: 'đâm dao', at: 0 }]);
  });

  it('refuses every repair when there are too many to be hearing errors', () => {
    const line = 'giao chiều sổ vạ rao';
    const proposals = [
      { heard: 'giao', said: 'dao' },
      { heard: 'chiều', said: 'triều' },
      { heard: 'sổ', said: 'xổ' },
      { heard: 'vạ', said: 'và' },
      { heard: 'rao', said: 'dao' },
    ];
    expect(proposals.length).toBeGreaterThan(MAX_REPAIRS_PER_TRANSCRIPT);
    expect(acceptHomophoneRepairs(line, proposals)).toEqual([]);
  });
});
