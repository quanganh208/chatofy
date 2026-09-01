/**
 * Replays real synthesized speech through the real capture pump.
 *
 * The unit tests next door drive the pump with square-edged tones: speech is
 * loud, silence is zero, and the boundary between them is exact. Speech is not
 * like that. It fades out across a syllable, breathes mid-sentence, and leaves
 * the level meter somewhere between the two for a while. Whether the early
 * transcription the server pays for is usable comes down to how the gate reads
 * those in-between moments, so it is worth reading them from actual audio.
 *
 * This imports the pump itself rather than restating what it does. A harness
 * that reimplements the logic it measures agrees with itself and nothing else —
 * which is exactly how the defect being guarded here survived: the tests that
 * covered it described a sequence of events the browser could not produce.
 *
 * Fixtures come from `benchmarks/realtime/generate-fixtures.mjs` and are not
 * committed. Without them the suite skips and says how to make them, rather
 * than passing silently on nothing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapturePump } from './capture-pump.js';
import { downsampleToPcm16, TARGET_SAMPLE_RATE } from './pcm-resampler.js';

/** What the browser worklet posts per block, at the context's own rate. */
const WORKLET_BLOCK_SAMPLES = 1024;
const FIXTURE_RATE = 48000;

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'benchmarks', 'realtime', 'fixtures');

interface Turn {
  id: string;
  commas: number;
  text: string;
  file: string;
}

/** Minimal RIFF reader — the fixtures are all 48 kHz mono PCM16. */
function readWavAsFloat(path: string): Float32Array {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`${path} is not a RIFF file`);
  }

  // Walk the chunk list rather than assuming `data` starts at byte 44; the
  // synthesizer is free to emit a LIST or fact chunk ahead of it.
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buffer.readInt16LE(offset + 8 + i * 2) / 0x8000;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

interface Replay {
  /** Blocks the pump chose to forward, in the order it forwarded them. */
  forwarded: number;
  /**
   * Blocks forwarded since the gate last suspected the turn was over.
   *
   * Counted from the LAST suspicion, not the first. A pause in the middle of a
   * sentence raises one and is then contradicted by the speaker carrying on,
   * at which point the held audio is released — correctly, or the utterance
   * would arrive spliced. What decides whether the server's early work is
   * usable is only whether anything followed the FINAL one.
   */
  forwardedSinceLastProbableEnd: number;
  probableEnds: number;
  turnOpened: boolean;
  turnClosed: boolean;
  /** Blocks forwarded since the gate FIRST suspected the turn was over. */
  forwardedSinceFirstProbableEnd: number;
  /**
   * Whether today's server can reuse its early work.
   *
   * The client asks it to guess at every suspicion, but the server accepts
   * only the first and ignores the rest, because each guess costs a
   * translation request against a per-minute ceiling. So the snapshot is taken
   * at the FIRST pause, and a speaker who carries on past it makes that
   * snapshot stale for the remainder of the turn — the request is spent and
   * cannot be redeemed.
   */
  headStartUsableOneShot: boolean;
  /**
   * What the same turn would yield if the guess could be renewed at each
   * suspicion instead of only the first.
   *
   * The gap between this and the line above is the entire value of moving from
   * one guess per turn to a continuous one — measured, rather than assumed.
   */
  headStartUsableIfRenewed: boolean;
}

/**
 * Trailing room tone, because a microphone does not stop when a sentence does.
 *
 * The synthesizer's file ends on the last syllable, so a fixture played as-is
 * never gives the gate the silence it needs to call the turn over — it would
 * measure a turn that never ends. Long enough here to outlast the hangover.
 */
const TRAILING_SILENCE_MS = 900;

/**
 * Room tone at a level the gate reads as silence.
 *
 * Not digital zero: a real room never is, and the gate learns its noise floor
 * from exactly these moments. Feeding it a perfect vacuum would let the floor
 * fall somewhere no microphone reaches and make the threshold easier to clear
 * than it will ever be in life. Deterministic so a rerun measures the same
 * thing twice.
 */
function roomTone(sampleCount: number): Float32Array {
  const tone = new Float32Array(sampleCount);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < sampleCount; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    tone[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.002;
  }
  return tone;
}

/** Push one fixture through the pump exactly as the worklet would. */
function replay(speech: Float32Array): Replay {
  const trailing = roomTone(Math.round((FIXTURE_RATE * TRAILING_SILENCE_MS) / 1000));
  const samples = new Float32Array(speech.length + trailing.length);
  samples.set(speech);
  samples.set(trailing, speech.length);

  let probableEnds = 0;
  let forwarded = 0;
  let forwardedSinceLastProbableEnd = 0;
  let forwardedSinceFirstProbableEnd = 0;
  let turnOpened = false;
  let turnClosed = false;

  const pump = new CapturePump(
    {
      onTurnOpen: () => {
        turnOpened = true;
      },
      onAudio: () => {
        forwarded += 1;
        if (probableEnds > 0) {
          forwardedSinceLastProbableEnd += 1;
          forwardedSinceFirstProbableEnd += 1;
        }
      },
      onProbableEnd: () => {
        probableEnds += 1;
        forwardedSinceLastProbableEnd = 0;
      },
      onTurnClose: () => {
        turnClosed = true;
      },
      onLevel: () => {},
    },
    Math.floor(WORKLET_BLOCK_SAMPLES / (FIXTURE_RATE / TARGET_SAMPLE_RATE)),
  );

  for (
    let offset = 0;
    offset + WORKLET_BLOCK_SAMPLES <= samples.length;
    offset += WORKLET_BLOCK_SAMPLES
  ) {
    pump.push(
      downsampleToPcm16(samples.subarray(offset, offset + WORKLET_BLOCK_SAMPLES), FIXTURE_RATE),
    );
  }

  return {
    forwarded,
    forwardedSinceLastProbableEnd,
    forwardedSinceFirstProbableEnd,
    probableEnds,
    turnOpened,
    turnClosed,
    headStartUsableOneShot: probableEnds > 0 && forwardedSinceFirstProbableEnd === 0,
    headStartUsableIfRenewed: probableEnds > 0 && forwardedSinceLastProbableEnd === 0,
  };
}

const manifestPath = join(FIXTURES, 'manifest.json');
const hasFixtures = existsSync(manifestPath);

/**
 * In CI, an absent fixture set is a FAILURE, not a skip.
 *
 * Skipping is right on a developer's machine, where the fixtures are an
 * optional 15MB of synthesized speech that has to be generated against a local
 * TTS sidecar. It is wrong in CI, where it reports green for a suite that ran
 * nothing — the sibling replay suite spent its whole life skipped there with
 * every one of its assertions quietly disabled, and nothing said so. The
 * `Realtime replay` job sets this variable once it has synthesized the
 * fixtures, so reaching here means that step failed without failing the build.
 */
if (!hasFixtures && process.env.REQUIRE_REALTIME_FIXTURES) {
  throw new Error(
    'capture-pump.replay: REQUIRE_REALTIME_FIXTURES is set but no fixtures manifest exists. ' +
      'The CI job must run `node benchmarks/realtime/generate-fixtures.mjs` first.',
  );
}

describe.skipIf(!hasFixtures)('CapturePump over real speech', () => {
  const turns: Turn[] = hasFixtures
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Turn[])
    : [];

  const replayed = turns.map((turn) => ({
    turn,
    result: replay(readWavAsFloat(join(FIXTURES, turn.file))),
  }));

  it('hears every fixture as a complete turn', () => {
    // A fixture the gate never opens or never closes measures nothing, and
    // would make every assertion below vacuously true.
    for (const { turn, result } of replayed) {
      expect(result.turnOpened, `${turn.id} never opened a turn`).toBe(true);
      expect(result.turnClosed, `${turn.id} never ended its turn`).toBe(true);
      expect(result.forwarded, `${turn.id} forwarded no audio`).toBeGreaterThan(0);
    }
  });

  // The property the head start depends on, checked against speech rather than
  // against tones. If a turn keeps sending after the gate last suspects the
  // end, the server's byte count moves and the transcription it already paid
  // for is thrown away.
  //
  // This is where the harness earned its keep: it first ran with the count
  // taken from the FIRST suspicion, and `pause-01` reported 87 blocks. The
  // pump was right and the measurement was wrong — a sentence with a breath in
  // the middle raises a suspicion, then withdraws it. No fixture built out of
  // tones had ever produced that shape.
  it('stops sending once it last suspects the end, on every fixture', () => {
    for (const { turn, result } of replayed) {
      expect(
        result.forwardedSinceLastProbableEnd,
        `${turn.id} forwarded ${result.forwardedSinceLastProbableEnd} blocks after the last probable end`,
      ).toBe(0);
    }
  });

  it('reports how often the head start survives a whole turn', () => {
    const pct = (n: number) => ((n / replayed.length) * 100).toFixed(0);
    const oneShot = replayed.filter((r) => r.result.headStartUsableOneShot);
    const renewed = replayed.filter((r) => r.result.headStartUsableIfRenewed);

    const rows = replayed.map(
      ({ turn, result }) =>
        `  ${turn.id.padEnd(10)} commas=${turn.commas} ` +
        `pauses=${result.probableEnds} ` +
        `blocks=${String(result.forwarded).padStart(3)} ` +
        `one-shot=${result.headStartUsableOneShot ? 'reusable' : 'LOST'} ` +
        `renewed=${result.headStartUsableIfRenewed ? 'reusable' : 'LOST'}`,
    );
    console.log(
      [
        '',
        `Head start, one guess per turn (today): ${oneShot.length}/${replayed.length} (${pct(oneShot.length)}%)`,
        `Head start, renewed at each pause:      ${renewed.length}/${replayed.length} (${pct(renewed.length)}%)`,
        ...rows,
        '',
      ].join('\n'),
    );

    // Deliberately not an assertion on either rate. The rates are the finding,
    // and pinning them here would turn a measurement into a target — the
    // fixtures would get tuned until it passed. Asserted only: that the
    // harness measured something, and that renewing can never do worse than
    // not renewing, which would mean the measurement itself is wrong.
    expect(replayed.length).toBeGreaterThan(0);
    expect(renewed.length).toBeGreaterThanOrEqual(oneShot.length);
  });
});
