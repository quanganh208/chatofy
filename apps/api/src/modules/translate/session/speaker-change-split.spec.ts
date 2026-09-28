import { describe, expect, it, vi } from 'vitest';
import {
  findInternalPauses,
  findSplitCandidate,
  groupByVoice,
  MAX_PIECES,
  piecesBetween,
  planSpeakerSplit,
  type JudgedPiece,
} from './speaker-change-split';

const RATE = 16000;

/** PCM16 from a list of stretches: `speech` is a loud tone, `silence` near-zero noise. */
function pcmOf(...parts: ['speech' | 'silence', number][]): Buffer {
  const samples: number[] = [];
  for (const [kind, ms] of parts) {
    const count = Math.round((RATE * ms) / 1000);
    for (let i = 0; i < count; i += 1) {
      samples.push(
        kind === 'speech' ? Math.round(8000 * Math.sin(i / 5)) : (i % 3) - 1,
      );
    }
  }
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buffer.writeInt16LE(s, i * 2));
  return buffer;
}

const A = [1, 0, 0];
const B = [0, 1, 0];
const piece = (
  startMs: number,
  endMs: number,
  vector: number[] | null,
): JudgedPiece => ({
  startMs,
  endMs,
  vector,
});

describe('findInternalPauses', () => {
  it('finds a pause of at least 300ms between two stretches of speech', () => {
    const pauses = findInternalPauses(
      pcmOf(['speech', 1000], ['silence', 400], ['speech', 1000]),
      RATE,
    );
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.startMs).toBeGreaterThanOrEqual(980);
    expect(pauses[0]!.endMs).toBeLessThanOrEqual(1420);
  });

  it('ignores a pause shorter than 300ms — phrasing inside one speaker', () => {
    expect(
      findInternalPauses(
        pcmOf(['speech', 1000], ['silence', 200], ['speech', 1000]),
        RATE,
      ),
    ).toEqual([]);
  });

  it('never returns the pre-roll or the trailing hangover', () => {
    expect(
      findInternalPauses(
        pcmOf(['silence', 600], ['speech', 1500], ['silence', 600]),
        RATE,
      ),
    ).toEqual([]);
  });

  it('returns nothing for a turn too short to hold a pause', () => {
    expect(findInternalPauses(Buffer.alloc(100), RATE)).toEqual([]);
  });
});

describe('piecesBetween', () => {
  it('returns the speech on either side of each pause', () => {
    expect(
      piecesBetween(3000, [
        { startMs: 1000, endMs: 1400 },
        { startMs: 2000, endMs: 2300 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1400, endMs: 2000 },
      { startMs: 2300, endMs: 3000 },
    ]);
  });
});

describe('groupByVoice', () => {
  it('keeps one voice in one run', () => {
    expect(groupByVoice([piece(0, 1000, A), piece(1400, 2400, A)])).toEqual([
      [0, 1],
    ]);
  });

  it('starts a new run where the voice changes', () => {
    expect(
      groupByVoice([
        piece(0, 1000, A),
        piece(1400, 2400, B),
        piece(2800, 3800, A),
      ]),
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('lets a piece too short to judge ride with the run before it', () => {
    expect(
      groupByVoice([
        piece(0, 1000, A),
        piece(1400, 1700, null),
        piece(2000, 3000, B),
      ]),
    ).toEqual([
      [0, 1],
      [2, 2],
    ]);
  });

  it('judges against the whole run, not just its last piece', () => {
    // The short middle piece leans towards B but still joins A (cosine 0.4).
    // Compared with that piece alone, B would join too; against the run, which
    // is mostly the long A, B is someone else.
    const leaning = [0.4, Math.sqrt(1 - 0.16), 0];
    expect(
      groupByVoice([
        piece(0, 2000, A),
        piece(2400, 2900, leaning),
        piece(3300, 4300, B),
      ]),
    ).toEqual([
      [0, 1],
      [2, 2],
    ]);
  });
});

describe('findSplitCandidate', () => {
  it('passes a turn with a pause and two sides long enough to judge', () => {
    const candidate = findSplitCandidate(
      pcmOf(['speech', 1000], ['silence', 400], ['speech', 1000]),
      RATE,
    );
    expect(candidate?.pieces).toHaveLength(2);
    expect(candidate?.durationMs).toBe(2400);
  });

  it('turns away a turn with no pause — the ordinary path, nothing spent', () => {
    expect(findSplitCandidate(pcmOf(['speech', 3000]), RATE)).toBeNull();
  });

  it('turns away a turn with only one side long enough to judge', () => {
    expect(
      findSplitCandidate(
        pcmOf(['speech', 1500], ['silence', 400], ['speech', 300]),
        RATE,
      ),
    ).toBeNull();
  });

  it('turns away a turn with more pieces than it will pay for', () => {
    const parts: ['speech' | 'silence', number][] = [];
    for (let i = 0; i <= MAX_PIECES; i += 1)
      parts.push(['speech', 600], ['silence', 350]);
    parts.push(['speech', 600]);
    expect(findSplitCandidate(pcmOf(...parts), RATE)).toBeNull();
  });

  it('places pauses by sample, not by rounded frame, at a rate 20ms does not divide', () => {
    // 11025Hz: a 20ms frame rounds to 221 samples. Counting frames × 20ms would
    // drift; counting samples keeps the pause where the silence is.
    const rate = 11025;
    // Syllabic, like real speech: the dips between syllables are what give a
    // long turn a quiet percentile to measure its floor from.
    const samples = (ms: number, loud: boolean) =>
      Array.from({ length: Math.round((rate * ms) / 1000) }, (_, i) =>
        loud && (i / rate) % 0.26 < 0.2
          ? Math.round(8000 * Math.sin(i / 5))
          : 0,
      );
    // 19.96s ends exactly on a syllable (76 cycles of 260ms, then 200ms of voice).
    const all = [
      ...samples(19_960, true),
      ...samples(400, false),
      ...samples(1000, true),
    ];
    const pcm = Buffer.alloc(all.length * 2);
    all.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
    const [pause] = findInternalPauses(pcm, rate);
    // Within one frame. Counting 20ms per frame would be ~45ms late here.
    expect(Math.abs(pause!.startMs - 19_960)).toBeLessThanOrEqual(21);
  });
});

describe('planSpeakerSplit', () => {
  const twoVoices = pcmOf(['speech', 1000], ['silence', 400], ['speech', 1000]);
  const candidate = findSplitCandidate(twoVoices, RATE)!;

  it('cuts in the middle of the pause when the two sides are different voices', async () => {
    const embed = vi.fn(async ({ startMs }: { startMs: number }) =>
      startMs === 0 ? A : B,
    );
    const plan = await planSpeakerSplit(candidate, embed);
    expect(plan).toHaveLength(2);
    expect(plan![0]!.startMs).toBe(0);
    expect(plan![1]!.endMs).toBe(2400);
    expect(plan![0]!.endMs).toBe(plan![1]!.startMs);
    expect(plan![0]!.endMs).toBeGreaterThan(1000);
    expect(plan![0]!.endMs).toBeLessThan(1400);
  });

  it('leaves a single voice whole', async () => {
    expect(await planSpeakerSplit(candidate, async () => A)).toBeNull();
  });

  it('keeps the turn whole when an embedding fails', async () => {
    const embed = async ({ startMs }: { startMs: number }) =>
      startMs === 0 ? A : null;
    expect(await planSpeakerSplit(candidate, embed)).toBeNull();
  });

  it('embeds only the pieces long enough to judge', async () => {
    const withShort = findSplitCandidate(
      pcmOf(
        ['speech', 1000],
        ['silence', 400],
        ['speech', 300],
        ['silence', 400],
        ['speech', 1000],
      ),
      RATE,
    )!;
    const embed = vi.fn(async () => A);
    await planSpeakerSplit(withShort, embed);
    expect(embed).toHaveBeenCalledTimes(2);
  });
});
