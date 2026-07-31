// Offline voice-activity reference: how much of a recording is actually speech.
//
// This exists to be the DENOMINATOR of the capture-coverage figure, and its whole
// value is that it does not share a line of reasoning with `SpeechGate`. Measuring
// coverage against the gate's own opinion of where speech is would be circular:
// every word the gate failed to hear would leave both the numerator and the
// denominator, and a gate that heard nothing at all would score 100%.
//
// So the method is deliberately different, not merely a second copy:
//
//   SpeechGate (streaming)          vad-reference (offline)
//   ----------------------          -----------------------
//   adaptive floor, one block       fixed threshold from the WHOLE file's
//     of lookahead                    energy distribution
//   fixed linear margin             margin in dB, with hysteresis
//   decides per block, never        median-smooths the mask, then applies
//     revises                        minimum-duration and gap-merge rules
//
// The offline side can use statistics over the entire recording, which a realtime
// gate structurally cannot. That asymmetry is the point: it is a fairer answer
// about where speech is, produced by a method the thing being measured has no
// access to.
//
// Usage:
//   node benchmarks/realtime/vad-reference.mjs <file.wav> [more.wav ...]
//   node benchmarks/realtime/vad-reference.mjs --json fixtures/long-01.wav
//   node benchmarks/realtime/vad-reference.mjs --manifest      # every fixture
//
// Reports, per file and in total: duration, speech duration, speech ratio and
// segment count. Coverage is then Σ capturedMs (over turns of EVERY outcome)
// divided by the speech duration reported here.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Analysis frame. 25ms with a 10ms hop is the usual speech-processing choice. */
const FRAME_MS = 25;
const HOP_MS = 10;

/**
 * How far above the estimated noise floor a frame must sit to count as speech.
 *
 * In decibels, unlike the gate's linear margin, because the quantity being
 * thresholded is level and level is logarithmic. 9 dB is roughly a tripling of
 * amplitude — comfortably above room tone, comfortably below normal speech.
 */
const SPEECH_MARGIN_DB = 9;

/**
 * Hysteresis: once inside speech, a frame may drop this much below the entry
 * threshold before it counts as having left.
 *
 * Without it the mask flickers on every unvoiced consonant, which then either
 * fragments one word into several segments or loses it to the minimum-duration
 * rule below.
 */
const HYSTERESIS_DB = 4;

/**
 * The noise floor is the Nth percentile of frame energy.
 *
 * A percentile rather than the minimum: one near-silent frame would drag the
 * minimum to the quantisation floor and make the threshold meaningless. 10% is
 * low enough to sit inside the quiet parts of any recording with real pauses in
 * it.
 */
const FLOOR_PERCENTILE = 0.1;

/** Absolute floor, so a recording with no silence at all cannot self-threshold. */
const MIN_FLOOR_DBFS = -70;

/** Frames of median smoothing applied to the raw mask. Odd, so there is a middle. */
const SMOOTH_FRAMES = 5;

/**
 * Speech separated by less than this is one segment.
 *
 * A stop consonant inside a word is a real silence of 30-80ms. Merging below
 * 180ms keeps words whole without swallowing the pauses between sentences.
 */
const MERGE_GAP_MS = 180;

/** Shorter than this is a click, a breath, or a door — not speech. */
const MIN_SEGMENT_MS = 90;

/**
 * Minimal RIFF reader for the mono 16-bit PCM files this harness deals in.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte header: real
 * encoders insert `LIST` and `fact` chunks, and a fixed offset silently reads
 * metadata as samples.
 */
function readWav(path) {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }

  let format;
  let samples;
  let offset = 12;
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
      samples = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    // Chunks are word-aligned; an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (!format || !samples) throw new Error(`${path} has no fmt or data chunk`);
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error(
      `${path} is not 16-bit PCM (format ${format.audioFormat}, ${format.bitsPerSample}-bit)`,
    );
  }

  // Mixed to mono by averaging, so a stereo file cannot report double duration.
  const total = Math.floor(samples.length / 2);
  const frames = Math.floor(total / format.channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < format.channels; c += 1) {
      sum += samples.readInt16LE((i * format.channels + c) * 2) / 0x8000;
    }
    mono[i] = sum / format.channels;
  }
  return { samples: mono, sampleRate: format.sampleRate };
}

const toDbfs = (rms) => (rms <= 0 ? -Infinity : 20 * Math.log10(rms));

/** Frame energies in dBFS, one per hop. */
function frameEnergies(samples, sampleRate) {
  const frameLen = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const hopLen = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const energies = [];

  for (let start = 0; start + frameLen <= samples.length; start += hopLen) {
    let sum = 0;
    for (let i = start; i < start + frameLen; i += 1) sum += samples[i] * samples[i];
    energies.push(toDbfs(Math.sqrt(sum / frameLen)));
  }
  return energies;
}

function percentile(values, fraction) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return MIN_FLOOR_DBFS;
  const index = Math.min(
    finite.length - 1,
    Math.max(0, Math.round(fraction * (finite.length - 1))),
  );
  return finite[index];
}

/** Median filter, to stop the mask flickering frame by frame. */
function smooth(mask) {
  const half = Math.floor(SMOOTH_FRAMES / 2);
  return mask.map((_, i) => {
    let votes = 0;
    let counted = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(mask.length - 1, i + half); j += 1) {
      votes += mask[j] ? 1 : 0;
      counted += 1;
    }
    return votes * 2 > counted;
  });
}

/** Contiguous true runs of the mask, in milliseconds. */
function maskToSegments(mask) {
  const segments = [];
  let start = null;
  mask.forEach((isSpeech, i) => {
    if (isSpeech && start === null) start = i;
    if (!isSpeech && start !== null) {
      segments.push({ startMs: start * HOP_MS, endMs: i * HOP_MS });
      start = null;
    }
  });
  if (start !== null) {
    segments.push({ startMs: start * HOP_MS, endMs: mask.length * HOP_MS });
  }
  return segments;
}

function mergeAndPrune(segments) {
  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && segment.startMs - last.endMs < MERGE_GAP_MS) {
      last.endMs = segment.endMs;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged.filter((s) => s.endMs - s.startMs >= MIN_SEGMENT_MS);
}

/** Speech segments and totals for one file. */
export function analyseWav(path) {
  const { samples, sampleRate } = readWav(path);
  const energies = frameEnergies(samples, sampleRate);

  const floorDbfs = Math.max(MIN_FLOOR_DBFS, percentile(energies, FLOOR_PERCENTILE));
  const enterDbfs = floorDbfs + SPEECH_MARGIN_DB;
  const exitDbfs = enterDbfs - HYSTERESIS_DB;

  // Hysteresis has to be applied as a walk, not a map: whether a frame is speech
  // depends on whether the previous one was.
  let inSpeech = false;
  const raw = energies.map((db) => {
    inSpeech = inSpeech ? db >= exitDbfs : db >= enterDbfs;
    return inSpeech;
  });

  const segments = mergeAndPrune(maskToSegments(smooth(raw)));
  const speechMs = segments.reduce((total, s) => total + (s.endMs - s.startMs), 0);
  const durationMs = (samples.length / sampleRate) * 1000;

  return {
    file: basename(path),
    durationMs: Math.round(durationMs),
    speechMs: Math.round(speechMs),
    speechRatio: durationMs > 0 ? speechMs / durationMs : 0,
    segments: segments.length,
    floorDbfs: Number(floorDbfs.toFixed(1)),
    thresholdDbfs: Number(enterDbfs.toFixed(1)),
    detail: segments.map((s) => ({ startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) })),
  };
}

function resolveInputs(args) {
  if (args.includes('--manifest')) {
    const manifestPath = join(HERE, 'fixtures', 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `no fixtures yet — run: node ${join('benchmarks', 'realtime', 'generate-fixtures.mjs')}`,
      );
    }
    return JSON.parse(readFileSync(manifestPath, 'utf8')).map((turn) =>
      join(HERE, 'fixtures', turn.file),
    );
  }
  return args.filter((arg) => !arg.startsWith('--'));
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const inputs = resolveInputs(args);

  if (inputs.length === 0) {
    console.error(
      'usage: node benchmarks/realtime/vad-reference.mjs [--json] <file.wav ...> | --manifest',
    );
    process.exit(2);
  }

  const results = inputs.map(analyseWav);

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('file                     duration    speech   ratio  segments  threshold');
  for (const r of results) {
    console.log(
      `${r.file.padEnd(24)} ${String(r.durationMs).padStart(7)}ms ${String(r.speechMs).padStart(7)}ms` +
        ` ${(r.speechRatio * 100).toFixed(1).padStart(5)}% ${String(r.segments).padStart(9)}` +
        `  ${String(r.thresholdDbfs).padStart(6)} dBFS`,
    );
  }

  const durationMs = results.reduce((t, r) => t + r.durationMs, 0);
  const speechMs = results.reduce((t, r) => t + r.speechMs, 0);
  console.log(
    `\ntotal: ${speechMs}ms speech in ${durationMs}ms ` +
      `(${((speechMs / durationMs) * 100).toFixed(1)}%) across ${results.length} file(s)`,
  );
  console.log(
    '\nThis is the coverage DENOMINATOR. The numerator is the sum of capturedMs over\n' +
      'turns of every outcome — including rejected, dropped and failed ones. Summing only\n' +
      'the turns that played measures the success rate of playback, not capture coverage,\n' +
      'and improves precisely when the pipeline is breaking.',
  );
}

// Importable for a test, runnable as a script.
if (process.argv[1] && basename(process.argv[1]) === 'vad-reference.mjs') main();
