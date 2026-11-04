import { describe, expect, it } from 'vitest';
import { MAX_INSERTED_WORDS, wordsLostAtSeam } from './seam-word-repair';

describe('wordsLostAtSeam', () => {
  it('finds the clause a cut dropped after a one-word piece', () => {
    expect(
      wordsLostAtSeam(
        'Exactly.',
        'crucial because it gets your brain thinking flexibly in English.',
        'Exactly, and this is crucial because',
      ),
    ).toBe('and this is');
  });

  it('finds a word dropped before a one-word turn', () => {
    expect(
      wordsLostAtSeam(
        'The problem is not knowledge.',
        'Activation.',
        'is not knowledge. Its activation.',
      ),
    ).toBe('Its');
  });

  it('keeps the clip spelling, marks and case', () => {
    expect(
      wordsLostAtSeam(
        'Thưa quý vị',
        'theo ủy ban nhân dân',
        'thưa quý vị XIN MỜI ANH VÂNG theo ủy ban',
      ),
    ).toBe('XIN MỜI ANH VÂNG');
  });

  it('ignores case and marks when matching the edges', () => {
    expect(
      wordsLostAtSeam(
        'we were here.',
        'Because of it.',
        'We were here, and then because of it',
      ),
    ).toBe('and then');
  });

  it('adds nothing when the clip heard no more than the turns', () => {
    expect(
      wordsLostAtSeam(
        'one two three',
        'four five six',
        'one two three four five six',
      ),
    ).toBeNull();
  });

  it('adds nothing when the clip does not repeat the left edge', () => {
    expect(
      wordsLostAtSeam('one two', 'five six', 'three four five six'),
    ).toBeNull();
  });

  it('adds nothing when the clip does not repeat the right edge', () => {
    expect(
      wordsLostAtSeam('one two', 'five six', 'one two three four'),
    ).toBeNull();
  });

  it('does not read a one-word side anywhere but the edge of the clip', () => {
    expect(
      wordsLostAtSeam('Right.', 'of way', 'all Right and the rest of way'),
    ).toBeNull();
    expect(
      wordsLostAtSeam('one two', 'Done.', 'one two three Done and more'),
    ).toBeNull();
  });

  it('does not take the right edge from before the left edge', () => {
    expect(
      wordsLostAtSeam('three four', 'one two', 'one two three four'),
    ).toBeNull();
  });

  it('refuses a gap too long to be a dropped tail', () => {
    const gap = Array.from(
      { length: MAX_INSERTED_WORDS + 1 },
      (_, i) => `w${i}`,
    ).join(' ');
    expect(
      wordsLostAtSeam('one two', 'three four', `one two ${gap} three four`),
    ).toBeNull();
  });

  it('accepts a gap of exactly the limit', () => {
    const gap = Array.from(
      { length: MAX_INSERTED_WORDS },
      (_, i) => `w${i}`,
    ).join(' ');
    expect(
      wordsLostAtSeam('one two', 'three four', `one two ${gap} three four`),
    ).toBe(gap);
  });

  it('adds nothing for an empty side or clip', () => {
    expect(wordsLostAtSeam('', 'three four', 'three four')).toBeNull();
    expect(wordsLostAtSeam('one two', '  ', 'one two')).toBeNull();
    expect(wordsLostAtSeam('one two', 'three four', '')).toBeNull();
  });
});
