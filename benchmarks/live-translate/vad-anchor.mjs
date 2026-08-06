// The common time origin for both arms, and the onset detector for the output.
//
// Every latency figure in this harness is measured from ONE moment: the end of
// speech in the source recording, computed offline. That choice is the whole
// methodology, so it is worth stating why the obvious alternatives are wrong.
//
//   `client.session.end`     — the cascade's own metrics use it, and it is the
//                              gate's CLOSE time: true end of speech plus
//                              SPEECH_HANGOVER_MS (500ms). Real waiting the
//                              listener feels, but not counted. Anchoring here
//                              flatters our own system by half a second.
//   `speechEndedAt`          — same value, same problem.
//   first output chunk       — Gemini has no endpoint at all, so there is
//                              nothing on its side to anchor to.
//
// Offline VAD on the fixture belongs to neither system, which is the only
// property that makes it fair. The detection itself is REUSED from
// `benchmarks/realtime/vad-reference.mjs` rather than reimplemented: two
// definitions of "where speech is" would drift, and the one that drifted would
// be the one nobody was reading.
//
// Usage:
//   node benchmarks/live-translate/vad-anchor.mjs <file.wav> [more.wav ...]
//   node benchmarks/live-translate/vad-anchor.mjs --self-test

import { readFileSync } from 'node:fs';
import { analyseWav } from '../realtime/vad-reference.mjs';

/**
 * End of the last speech segment, in ms from the start of the file.
 *
 * The LAST segment, not the end of the file: fixtures carry trailing silence on
 * purpose (the model needs it to know the utterance ended), and anchoring on the
 * file end would charge every arm for padding the harness itself added.
 */
export function speechEndMs(wavPath) {
  const { detail } = analyseWav(wavPath);
  if (detail.length === 0) return null;
  return detail[detail.length - 1].endMs;
}

/** Start of the first speech segment — the other end of the utterance. */
export function speechStartMs(wavPath) {
  const { detail } = analyseWav(wavPath);
  return detail.length === 0 ? null : detail[0].startMs;
}

/**
 * Amplitude below which a 20 ms window counts as silence.
 *
 * 16-bit full scale is 32768, so this is about -32 dBFS: comfortably above
 * dither and codec noise, comfortably below speech. The spike measured a peak of
 * 21010 on real translated output, so speech clears it by a factor of 25.
 */
const ONSET_THRESHOLD = 800;
const ONSET_WINDOW_MS = 20;

/**
 * Index of the first sample of actual speech in a PCM buffer.
 *
 * A tested function rather than an inline loop, because "first output audio" is
 * the headline metric and the way it breaks is silent. The live model mirrors
 * input silence back into its output stream, so a run CAN begin with quiet even
 * though the spike's two runs did not — and a first-audio timestamp that
 * measured a silence frame would look perfectly reasonable in the table.
 *
 * Returns null when the buffer carries no speech at all.
 */
export function firstSpeechSampleIndex(pcm, sampleRate, threshold = ONSET_THRESHOLD) {
  const windowSamples = Math.max(1, Math.round((sampleRate * ONSET_WINDOW_MS) / 1000));
  for (let start = 0; start + 1 < pcm.length / 2; start += windowSamples) {
    const end = Math.min(start + windowSamples, Math.floor(pcm.length / 2));
    for (let i = start; i < end; i += 1) {
      if (Math.abs(pcm.readInt16LE(i * 2)) > threshold) return start;
    }
  }
  return null;
}

/** The same answer in milliseconds, or null when the buffer is all silence. */
export function firstSpeechMs(pcm, sampleRate, threshold = ONSET_THRESHOLD) {
  const index = firstSpeechSampleIndex(pcm, sampleRate, threshold);
  return index === null ? null : (index / sampleRate) * 1000;
}

/**
 * Trim trailing silence before reporting how long an output was.
 *
 * The live model mirrors the stream it was fed, so a clip padded with 4 s of
 * silence comes back with about 4 s of silence attached. Reporting that as
 * output duration would make the continuous arm look slower to finish than it
 * is, for a reason the harness created.
 */
export function speechDurationMs(pcm, sampleRate, threshold = ONSET_THRESHOLD) {
  const total = Math.floor(pcm.length / 2);
  const windowSamples = Math.max(1, Math.round((sampleRate * ONSET_WINDOW_MS) / 1000));
  const first = firstSpeechSampleIndex(pcm, sampleRate, threshold);
  if (first === null) return 0;
  let last = first;
  for (let start = 0; start < total; start += windowSamples) {
    const end = Math.min(start + windowSamples, total);
    for (let i = start; i < end; i += 1) {
      if (Math.abs(pcm.readInt16LE(i * 2)) > threshold) {
        last = end;
        break;
      }
    }
  }
  return ((last - first) / sampleRate) * 1000;
}

/** Synthetic checks, so the detector is not trusted on the strength of its comments. */
function selfTest() {
  const rate = 24000;
  const pcm = (spec) => {
    const buf = Buffer.alloc(spec.reduce((n, [ms]) => n + (rate * ms) / 1000, 0) * 2);
    let i = 0;
    for (const [ms, amplitude] of spec) {
      for (let n = 0; n < (rate * ms) / 1000; n += 1, i += 1) {
        buf.writeInt16LE(amplitude === 0 ? 0 : n % 2 ? amplitude : -amplitude, i * 2);
      }
    }
    return buf;
  };

  const cases = [
    ['all silence has no onset', firstSpeechMs(pcm([[500, 0]]), rate), null],
    ['speech from the first sample', firstSpeechMs(pcm([[500, 8000]]), rate), 0],
    // The case that matters: mirrored input silence in front of real output.
    [
      '1s of leading silence',
      Math.round(
        firstSpeechMs(
          pcm([
            [1000, 0],
            [500, 8000],
          ]),
          rate,
        ),
      ),
      1000,
    ],
    ['dither is not speech', firstSpeechMs(pcm([[500, 100]]), rate), null],
    [
      'trailing silence is not duration',
      Math.round(
        speechDurationMs(
          pcm([
            [200, 8000],
            [4000, 0],
          ]),
          rate,
        ),
      ),
      200,
    ],
  ];

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — got ${actual}, want ${expected}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  if (args.length === 0) {
    console.error('usage: node vad-anchor.mjs <file.wav> [...] | --self-test');
    process.exit(2);
  }
  for (const file of args) {
    readFileSync(file); // fail loudly on a missing path before analysing
    console.log(
      JSON.stringify({
        file,
        speechStartMs: speechStartMs(file),
        speechEndMs: speechEndMs(file),
      }),
    );
  }
}

if (process.argv[1]?.endsWith('vad-anchor.mjs')) main();
