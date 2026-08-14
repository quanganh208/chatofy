import {
  commonPrefixLength,
  normalizeForComparison,
} from './transcript-normalizer';

describe('normalizeForComparison', () => {
  // The exact rewrite the English recogniser performed on a growing buffer.
  // Compared raw these are different words and the commit policy would treat a
  // spoken word as contradicted; that is the defect this function prevents.
  it('reads the measured seven/7 rewrite as the same words', () => {
    expect(normalizeForComparison('at seven in the morning', 'en')).toEqual(
      normalizeForComparison('at 7 in the morning', 'en'),
    );
  });

  it('still reports a real change in the same read', () => {
    // "morning" -> "Eve" is a different word, not different spelling, and must
    // survive normalization or the policy would never notice a real flip.
    expect(normalizeForComparison('at 7 in the Eve', 'en')).not.toEqual(
      normalizeForComparison('at seven in the morning', 'en'),
    );
  });

  it('drops punctuation so a revised sentence boundary is not a word change', () => {
    expect(normalizeForComparison('at set.', 'en')).toEqual(['at', 'set']);
  });

  it('matches Vietnamese digits against their spoken form', () => {
    expect(normalizeForComparison('hai người', 'vi')).toEqual(
      normalizeForComparison('2 người', 'vi'),
    );
  });

  it('expands a multi-word Vietnamese number into multiple tokens', () => {
    // "mười một" is two tokens; collapsing it to one would misalign every
    // comparison after it.
    expect(normalizeForComparison('11', 'vi')).toEqual(['mười', 'một']);
  });

  it('leaves a number with no entry alone rather than guessing', () => {
    expect(normalizeForComparison('1975', 'en')).toEqual(['1975']);
  });

  it('lowercases so casing changes between reads are not word changes', () => {
    expect(normalizeForComparison('Xin Chào', 'vi')).toEqual(['xin', 'chào']);
  });

  it('returns nothing for blank input', () => {
    expect(normalizeForComparison('   ', 'en')).toEqual([]);
  });
});

describe('commonPrefixLength', () => {
  it('counts the shared head and stops at the first difference', () => {
    expect(commonPrefixLength(['a', 'b', 'c'], ['a', 'b', 'x'])).toBe(2);
  });

  it('is bounded by the shorter sequence', () => {
    expect(commonPrefixLength(['a', 'b'], ['a', 'b', 'c'])).toBe(2);
  });

  it('is zero when nothing matches', () => {
    expect(commonPrefixLength(['a'], ['b'])).toBe(0);
  });
});
