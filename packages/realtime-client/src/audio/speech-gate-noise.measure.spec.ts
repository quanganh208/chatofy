/**
 * Baseline for the second noise problem: how the RMS `SpeechGate` degrades as
 * the room gets louder.
 *
 * The gate ends a turn from level against an adaptive noise floor. A noisy room
 * raises two failures this measures directly:
 *
 *   - **False starts** — room tone crosses the speech margin and opens a turn
 *     nobody spoke. Measured on pure noise, where the ground truth is known by
 *     construction: every start is wrong.
 *   - **Lost or late endpoints** — noise in the trailing silence keeps counting
 *     as speech, so the hangover never elapses and the turn runs on, or a second
 *     turn opens in what should be quiet. Measured on speech followed by a noise
 *     bed, against the boundary the fixture was built with.
 *
 * This is the **ruler** the denoise and learned-VAD phases are measured against,
 * so it changes no behaviour and asserts no threshold — a pass/fail line on a
 * false-start rate would only describe the noise seed it last ran on. It reports
 * the sweep and asserts only that the harness still drives the real gate the way
 * a clean room does (the sanity arm below).
 *
 *   MEASURE_NOISE=1 pnpm --filter @chatofy/realtime-client exec vitest run \
 *     src/audio/speech-gate-noise.measure.spec.ts
 *
 * **Faithfulness, and its one limit.** The gate never sees a sample — its whole
 * input is a level and a duration — so the honest way to drive it is real audio
 * through the real path: gaussian noise at 48 kHz, the production block size, the
 * real `downsampleToPcm16`, the real `pcm16Rms`. The per-block RMS then
 * fluctuates on its own, and that fluctuation is exactly what trips a false
 * start; a flat bed would under-count them. The limit is that gaussian noise is
 * white and stationary, where a café or a fan has structure and transients a
 * white bed lacks. So these are a **floor** on the false-start rate, not an
 * estimate of it — the same caveat `generate-fixtures.mjs` records about
 * synthetic speech. A recording of a real noisy room is what tightens it, and
 * the noisy-WER arm in `benchmarks/noise` is where that corpus lands.
 */
import { describe, expect, it } from 'vitest';
import { SpeechGate, type SpeechEndReason } from './speech-gate.js';
import { downsampleToPcm16, pcm16Rms } from './pcm-resampler.js';

/** The worklet delivers 1024-sample blocks; capture runs at the device rate. */
const WORKLET_BLOCK_SAMPLES = 1024;
const CAPTURE_RATE = 48000;
const BLOCK_MS = (WORKLET_BLOCK_SAMPLES / CAPTURE_RATE) * 1000;

/**
 * RMS a spoken block sits at, well above the ~0.022 the gate treats as the edge
 * of speech in a quiet room. Fixed across the sweep so the varying term is the
 * noise alone and the reported SNR means what it says.
 */
const SPEECH_RMS = 0.18;

/**
 * Noise levels to sweep, as target block RMS. Chosen to straddle the gate's
 * clean speech edge (~0.022): the first few sit under it, the last few over, so
 * the table shows where room tone starts opening turns on its own.
 */
const NOISE_RMS_SWEEP = [0.002, 0.005, 0.008, 0.012, 0.016, 0.02, 0.028];

/** One deterministic PRNG per arm, so a recorded baseline is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zero-mean gaussian via Box-Muller, so a block's RMS lands near `std`. */
function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One 48 kHz block of gaussian samples whose RMS is approximately `rms`. */
function noiseBlock(rand: () => number, rms: number): Float32Array {
  const block = new Float32Array(WORKLET_BLOCK_SAMPLES);
  for (let i = 0; i < block.length; i++) block[i] = gaussian(rand) * rms;
  return block;
}

/** The level the gate actually sees for a block, down the real capture path. */
function blockLevel(block: Float32Array): number {
  return pcm16Rms(downsampleToPcm16(block, CAPTURE_RATE));
}

const dbSnr = (signal: number, noise: number): number =>
  noise <= 0 ? Infinity : 20 * Math.log10(signal / noise);

interface Counts {
  starts: number;
  ends: number;
}

/** Drive the real gate over N ms of pure noise; count the turns it invented. */
function countFalseStarts(rand: () => number, noiseRms: number, durationMs: number): Counts {
  const counts: Counts = { starts: 0, ends: 0 };
  const gate = new SpeechGate({
    onSpeechStart: () => (counts.starts += 1),
    onSpeechEnd: () => (counts.ends += 1),
  });
  for (let elapsed = 0; elapsed < durationMs; elapsed += BLOCK_MS) {
    gate.push(blockLevel(noiseBlock(rand, noiseRms)), BLOCK_MS);
  }
  return counts;
}

interface Endpoint {
  /** Ms from the true end of speech to the gate's hangover end, or NaN if lost. */
  latencyMs: number;
  /** Turns opened after the true end — a second turn in what should be quiet. */
  extraStarts: number;
  endReason?: SpeechEndReason;
}

/**
 * Speak for `speechMs`, then lay a noise bed for `tailMs`, and measure when the
 * gate calls the turn over relative to the speech ending.
 */
function measureEndpoint(
  rand: () => number,
  noiseRms: number,
  speechMs: number,
  tailMs: number,
): Endpoint {
  let starts = 0;
  let endAtMs = Number.NaN;
  let endReason: SpeechEndReason | undefined;
  let elapsed = 0;

  const gate = new SpeechGate({
    onSpeechStart: () => (starts += 1),
    onSpeechEnd: (reason) => {
      if (Number.isNaN(endAtMs)) {
        endAtMs = elapsed;
        endReason = reason;
      }
    },
  });

  // Speech is a louder gaussian over the same bed, so the tail is the only thing
  // that changes between arms.
  for (; elapsed < speechMs; elapsed += BLOCK_MS) {
    const block = noiseBlock(rand, noiseRms);
    const speech = noiseBlock(rand, SPEECH_RMS);
    for (let i = 0; i < block.length; i++) block[i] = block[i]! + speech[i]!;
    gate.push(blockLevel(block), BLOCK_MS);
  }
  const startsBeforeTail = starts;

  for (let tail = 0; tail < tailMs; tail += BLOCK_MS, elapsed += BLOCK_MS) {
    gate.push(blockLevel(noiseBlock(rand, noiseRms)), BLOCK_MS);
  }

  return {
    latencyMs: Number.isNaN(endAtMs) ? Number.NaN : endAtMs - speechMs,
    extraStarts: starts - startsBeforeTail,
    endReason,
  };
}

const enabled = !!process.env.MEASURE_NOISE;

describe.skipIf(!enabled)('SpeechGate baseline under noise', () => {
  it('sanity: a clean room opens one turn and ends it on the hangover', () => {
    // The floor the whole sweep is read against. If this drifts, the harness has
    // stopped driving the gate the way production does and no row below is
    // trustworthy — so this is the one arm that asserts.
    const point = measureEndpoint(mulberry32(1), 0.001, 1500, 1500);

    expect(point.endReason).toBe('hangover');
    expect(point.extraStarts).toBe(0);
    // ~500ms hangover plus up to a block of quantisation; nowhere near lost.
    expect(point.latencyMs).toBeGreaterThan(400);
    expect(point.latencyMs).toBeLessThan(700);
  });

  it('reports false-start rate across the noise sweep', () => {
    const durationMs = 60_000;
    const rows = NOISE_RMS_SWEEP.map((noiseRms, i) => {
      const { starts, ends } = countFalseStarts(mulberry32(100 + i), noiseRms, durationMs);
      const perMin = (starts / durationMs) * 60_000;
      return { noiseRms, snr: dbSnr(SPEECH_RMS, noiseRms), starts, ends, perMin };
    });

    console.log(
      [
        '',
        `False starts over ${durationMs / 1000}s of pure gaussian noise (no speech).`,
        'Every start is wrong by construction; the number is starts per minute.',
        '',
        '  noise-rms   SNR      false-starts/min',
        ...rows.map(
          (r) =>
            `  ${r.noiseRms.toFixed(3).padStart(8)}  ${`${r.snr.toFixed(0)}dB`.padStart(6)}  ${r.perMin.toFixed(1).padStart(18)}`,
        ),
        '',
      ].join('\n'),
    );

    expect(rows.length).toBe(NOISE_RMS_SWEEP.length);
  });

  it('reports endpoint latency across the noise sweep', () => {
    const rows = NOISE_RMS_SWEEP.map((noiseRms, i) => {
      const point = measureEndpoint(mulberry32(200 + i), noiseRms, 1500, 2500);
      return { noiseRms, snr: dbSnr(SPEECH_RMS, noiseRms), ...point };
    });

    console.log(
      [
        '',
        'Endpoint after 1500ms speech + a 2500ms noise bed. Latency is ms from the',
        'speech ending to the hangover end; "lost" means the turn never closed in',
        'the tail. extra-starts counts turns opened in what should be quiet.',
        '',
        '  noise-rms   SNR      end-latency   reason   extra-starts',
        ...rows.map(
          (r) =>
            `  ${r.noiseRms.toFixed(3).padStart(8)}  ${`${r.snr.toFixed(0)}dB`.padStart(6)}  ` +
            `${(Number.isNaN(r.latencyMs) ? 'lost' : `${Math.round(r.latencyMs)}ms`).padStart(11)}  ` +
            `${(r.endReason ?? '—').padStart(8)}  ${String(r.extraStarts).padStart(12)}`,
        ),
        '',
      ].join('\n'),
    );

    expect(rows.length).toBe(NOISE_RMS_SWEEP.length);
  });
});
