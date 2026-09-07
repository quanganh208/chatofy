import { describe, expect, it } from 'vitest';
import { splitIntoClauses } from './clause-splitter';

describe('splitIntoClauses', () => {
  // The exact sentences the latency spike measured, so a regression here is a
  // regression in the number the streaming path was built to hit.
  it('splits the measured English turns at their leading clause', () => {
    expect(splitIntoClauses('Hello, how much does this cost?')).toEqual([
      'Hello,',
      'how much does this cost?',
    ]);
    expect(
      splitIntoClauses(
        'Excuse me, could you tell me where the train station is?',
      ),
    ).toEqual(['Excuse me,', 'could you tell me where the train station is?']);
  });

  it('splits the measured Vietnamese turns at their leading clause', () => {
    expect(splitIntoClauses('Xin chào, cái này giá bao nhiêu?')).toEqual([
      'Xin chào,',
      'cái này giá bao nhiêu?',
    ]);
  });

  it('splits a multi-sentence turn at every sentence', () => {
    expect(splitIntoClauses('I am fine. What about you? Great!')).toEqual([
      'I am fine.',
      'What about you?',
      'Great!',
    ]);
  });

  it('keeps punctuation with the part it follows', () => {
    // The engine takes its intonation from the mark; stripping it flattens the
    // clause into a statement.
    for (const part of splitIntoClauses('Wait, really?')) {
      expect(part).toMatch(/[,?]$/);
    }
  });

  it('returns one part when there is no boundary', () => {
    expect(splitIntoClauses('hello there')).toEqual(['hello there']);
  });

  it('returns nothing for blank input', () => {
    expect(splitIntoClauses('   ')).toEqual([]);
    expect(splitIntoClauses('')).toEqual([]);
  });

  // A decimal point or comma is not a clause boundary. Splitting there would
  // hand the engine "1," and "5 triệu đồng" and read the number wrong.
  describe('does not split inside numbers', () => {
    it('leaves an English decimal alone', () => {
      expect(splitIntoClauses('It costs 3.5 dollars')).toEqual([
        'It costs 3.5 dollars',
      ]);
    });

    it('leaves a Vietnamese decimal comma alone', () => {
      expect(splitIntoClauses('Giá 1,5 triệu đồng')).toEqual([
        'Giá 1,5 triệu đồng',
      ]);
    });
  });

  describe('absorbs fragments too short to synthesize', () => {
    it('folds an abbreviation into the clause that follows', () => {
      expect(splitIntoClauses('Mr. Smith is here')).toEqual([
        'Mr. Smith is here',
      ]);
    });

    it('folds a trailing fragment back into the previous part', () => {
      expect(splitIntoClauses('Come here, now, ok')).toEqual([
        'Come here,',
        'now, ok',
      ]);
    });

    // "Hello," is 6 characters — the split that produced the largest measured
    // win. A fragment floor that swallowed it would erase the whole benefit.
    it('keeps a short leading clause that pays for itself', () => {
      expect(splitIntoClauses('Hello, how are you?')).toHaveLength(2);
    });
  });

  it('handles runs of punctuation as one boundary', () => {
    expect(splitIntoClauses('Really?! I had no idea...')).toEqual([
      'Really?!',
      'I had no idea...',
    ]);
  });

  it('is stable across calls', () => {
    // The boundary regex is module-level and global; a leaked lastIndex would
    // make the second call skip the first boundary.
    const once = splitIntoClauses('Hello, how are you?');
    expect(splitIntoClauses('Hello, how are you?')).toEqual(once);
  });
});
