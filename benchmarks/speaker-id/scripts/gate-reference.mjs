// Parity oracle: the REAL production speech gate, driven offline over a WAV.
//
// `speaker_bench/segment.py` is a Python port of
// `packages/realtime-client/src/audio/speech-gate.ts`. A silent drift in that
// port would move every cut boundary and quietly poison every downstream
// number, so it is checked against the genuine article rather than trusted.
//
// WHY NOT `benchmarks/realtime/vad-reference.mjs`: that file is not a second
// copy of the gate, and its own header says so — it exists precisely so that it
// does NOT share a line of reasoning with SpeechGate (whole-file energy
// threshold vs adaptive floor, dB margin with hysteresis vs a fixed linear
// margin, median-smoothed mask vs per-block streaming decisions never revised).
// It is the independent denominator for capture coverage. A CORRECT port of
// SpeechGate would legitimately disagree with it, so using it here would either
// fail spuriously or need a tolerance wide enough to prove nothing. Both sides
// must run the same algorithm for the tolerance to mean anything.
//
// The gate is not exported from `@chatofy/realtime-client`'s index, and it uses
// a TypeScript parameter property (`private readonly handlers`), which is not
// erasable syntax — so Node's type stripping cannot load it. It is transpiled
// here with the workspace's own esbuild instead, together with
// `pcm-resampler.ts` so that the resample and RMS are the REAL ones rather than
// copies that could drift. Both files have zero imports, so this is a plain
// transpile, not a bundle.
//
// Usage:
//   node scripts/gate-reference.mjs <file.wav> [--max-utterance-ms N] [--block-samples N]
//
// The WAV is read at its OWN rate (fixtures are 48 kHz) and downsampled per
// block, because that is what production does.
//
// Emits JSON to stdout:
//   { sampleRate, blockSamples, blockMs, blocks, maxUtteranceMs, events, speechMask }
// where each event is { type, blockIndex, atMs, reason? } and `speechMask` is
// `gate.push`'s return per block — the same two things
// `speaker_bench.segment.run_gate` returns.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(BENCH_ROOT, '..', '..');
const REALTIME_SRC = resolve(REPO_ROOT, 'packages/realtime-client/src/audio');
// Both files have zero imports, so this is a plain transpile, not a bundle.
const SOURCES = ['speech-gate.ts', 'pcm-resampler.ts'];
const CACHE_DIR = resolve(BENCH_ROOT, '.cache');

// Samples the capture worklet posts per block, at the AudioContext's OWN rate.
// Must match `WORKLET_BLOCK_SAMPLES` in `speaker_bench/segment.py`.
const WORKLET_BLOCK_SAMPLES = 1024;
// `TARGET_SAMPLE_RATE` is imported from the real pcm-resampler at run time
// rather than hardcoded here; see loadRealtimeModules().

/**
 * Transpile the real gate AND the real resampler into `.cache/`, then import both.
 *
 * The resampler matters as much as the gate. If this script hand-copied
 * `downsampleToPcm16`/`pcm16Rms` and the Python side hand-copied them too, the
 * two could agree exactly while BOTH mis-modelling production — parity would
 * stay green and prove nothing about the framing. Worse, it would stay green
 * forever if `pcm-resampler.ts` later changed. Importing the real functions
 * closes that whole class: the only things still modelled by hand here are WAV
 * reading and the 1024-sample blocking.
 *
 * esbuild is not a dependency of this bench — benchmarks here carry no
 * package.json by convention, and every other .mjs under `benchmarks/` runs on
 * bare Node. It is borrowed from the realtime-client package, which already has
 * it. If that ever stops resolving, this fails loudly with the fix rather than
 * falling back to hand-written copies, which is the one thing this script
 * exists to avoid.
 */
async function loadRealtimeModules() {
  mkdirSync(CACHE_DIR, { recursive: true });
  try {
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@chatofy/realtime-client',
        'exec',
        'esbuild',
        ...SOURCES.map((name) => resolve(REALTIME_SRC, name)),
        '--format=esm',
        `--outdir=${CACHE_DIR}`,
        // Without this esbuild writes .js, and this directory has no
        // package.json — Node would load ESM output as CommonJS and fail.
        '--out-extension:.js=.mjs',
        '--log-level=warning',
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch (cause) {
    throw new Error(
      'Could not transpile the realtime-client audio sources with esbuild.\n' +
        'This bench borrows esbuild from @chatofy/realtime-client. Try:\n' +
        '  pnpm install\n' +
        '  pnpm --filter @chatofy/realtime-client exec esbuild --version\n' +
        'Do NOT substitute vad-reference.mjs as the oracle — it is a different ' +
        'algorithm on purpose (see the header of this file).',
      { cause },
    );
  }

  const loaded = {};
  for (const name of SOURCES) {
    const out = resolve(CACHE_DIR, name.replace(/\.ts$/, '.mjs'));
    if (!existsSync(out)) throw new Error(`esbuild produced no output at ${out}`);
    Object.assign(loaded, await import(pathToFileURL(out).href));
  }
  return loaded;
}

/**
 * Minimal RIFF/WAVE reader for 16-bit PCM mono.
 *
 * Chunks are walked rather than assumed at fixed offsets: a WAV written by a
 * browser or by ffmpeg often carries `LIST`/`fact` chunks before `data`, and
 * reading at a hardcoded offset would silently return header bytes as audio.
 */
function readWavPcm16(path) {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }

  let offset = 12;
  let format = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    // Chunks are word-aligned: an odd size is followed by one pad byte.
    offset = body + size + (size % 2);
  }

  if (!format) throw new Error(`${path}: no fmt chunk`);
  if (!data) throw new Error(`${path}: no data chunk`);
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error(
      `${path}: expected 16-bit PCM, got format ${format.audioFormat}/${format.bitsPerSample}-bit`,
    );
  }
  if (format.channels !== 1)
    throw new Error(`${path}: expected mono, got ${format.channels} channels`);

  // Source rate is whatever the file says. Production captures at the
  // AudioContext's rate (typically 48 kHz) and downsamples per block, so the
  // file's own rate is the thing to model — not a rate to normalise away here.
  const samples = new Float32Array(data.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 0x8000;
  return { samples, sampleRate: format.sampleRate };
}

/** Parse a numeric flag, refusing NaN — silently becoming NaN would disable the
 * ceiling (`maxUtteranceMs > 0` is false) and make the run look like a default
 * one, so a typo would quietly weaken the parity check rather than fail it. */
function numeric(flag, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${flag} expects a number, got ${raw}`);
  return value;
}

function parseArgs(argv) {
  const positional = [];
  const options = { maxUtteranceMs: 0, blockSamples: WORKLET_BLOCK_SAMPLES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-utterance-ms') options.maxUtteranceMs = numeric(argv[i], argv[++i]);
    else if (argv[i] === '--block-samples') options.blockSamples = numeric(argv[i], argv[++i]);
    else positional.push(argv[i]);
  }
  return { positional, options };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1) {
    process.stderr.write(
      'usage: node scripts/gate-reference.mjs <file.wav> [--max-utterance-ms N] [--block-samples N]\n',
    );
    process.exit(2);
  }

  const { SpeechGate, downsampleToPcm16, pcm16Rms, TARGET_SAMPLE_RATE } =
    await loadRealtimeModules();
  const { samples, sampleRate } = readWavPcm16(positional[0]);
  const { blockSamples, maxUtteranceMs } = options;
  // Derived from the DOWNSAMPLED length, exactly as `CapturePump` does.
  const blockMs =
    (Math.floor(blockSamples / (sampleRate / TARGET_SAMPLE_RATE)) / TARGET_SAMPLE_RATE) * 1000;

  const events = [];
  // Per-block `isSpeech`. This is what drives net-speech accounting on the
  // Python side, and a drift in noise-floor adaptation can flip borderline
  // blocks without moving any event — so it must be compared directly, not
  // inferred from event placement.
  const speechMask = [];
  let index = -1;
  const at = (type, reason) => {
    const event = { type, blockIndex: index, atMs: (index + 1) * blockMs };
    if (reason) event.reason = reason;
    events.push(event);
  };

  const gate = new SpeechGate(
    {
      onSpeechStart: () => at('start'),
      onProbableEnd: () => at('probableEnd'),
      onSpeechEnd: (reason) => at('end', reason),
    },
    maxUtteranceMs > 0 ? { maxUtteranceMs } : {},
  );

  // Drop the short tail rather than padding it: production never sees a short
  // block, because the worklet only posts once its buffer is full.
  const blocks = Math.floor(samples.length / blockSamples);
  for (index = 0; index < blocks; index++) {
    const block = samples.subarray(index * blockSamples, (index + 1) * blockSamples);
    speechMask.push(gate.push(pcm16Rms(downsampleToPcm16(block, sampleRate)), blockMs));
  }

  process.stdout.write(
    `${JSON.stringify(
      { sampleRate, blockSamples, blockMs, blocks, maxUtteranceMs, events, speechMask },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
