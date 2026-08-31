import { MINUTES_LIMITS, type MinutesSourceTurn } from '@chatofy/types';
import { chunkTurns } from './chunk-turns';

const turn = (text: string, label = 'S'): MinutesSourceTurn => ({
  speakerLabel: label,
  text,
});

/** The chars a turn contributes to the built transcript: `label: text\n`. */
const lineChars = (t: MinutesSourceTurn) =>
  t.speakerLabel.length + 2 + t.text.length + 1;

describe('chunkTurns', () => {
  it('keeps a conversation under the budget as a single chunk', () => {
    const turns = [turn('hello'), turn('hi')];
    expect(chunkTurns(turns)).toEqual([turns]);
  });

  it('never splits a turn and never exceeds the budget per chunk', () => {
    const turns = Array.from({ length: 10 }, () => turn('x'.repeat(30)));
    const chunks = chunkTurns(turns, 100); // tiny budget to force splitting

    for (const chunk of chunks) {
      const chars = chunk.reduce((sum, t) => sum + lineChars(t), 0);
      expect(chars).toBeLessThanOrEqual(100);
    }
    // Every original turn appears exactly once, in order.
    expect(chunks.flat()).toEqual(turns);
  });

  it('packs greedily up to the budget boundary', () => {
    const t = turn('abcd'); // lineChars = 1 + 2 + 4 + 1 = 8
    const turns = Array.from({ length: 5 }, () => t);
    // Budget 16 fits exactly two lines (16) before a third would overflow.
    expect(chunkTurns(turns, 16).map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('puts a lone over-budget turn in its own chunk rather than splitting it', () => {
    const big = turn('x'.repeat(50));
    const chunks = chunkTurns([turn('a'), big], 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toEqual([big]);
  });

  it('defaults to the chunk budget from MINUTES_LIMITS', () => {
    expect(MINUTES_LIMITS.MINUTES_CHUNK_CHARS).toBe(80_000);
    const turns = [turn('hi')];
    expect(chunkTurns(turns)).toEqual([turns]);
  });
});
