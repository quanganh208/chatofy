// Reference for the server's within-turn speaker split, driven offline.
//
// `apps/api/src/modules/translate/session/speaker-change-split.ts` decides
// whether one captured turn actually holds two voices and, if so, where to cut
// it. `SPLIT_COSINE` — the cosine below which the next piece is judged a
// different voice — is module-private since the pluggable-languages merge, so
// this script never reads it: it goes through `groupByVoice`, the same way a
// caller in production would, and the sweep in `split_cosine_sweep.py` ports
// the grouping rule into Python to test other thresholds, verifying the port
// against this script's real output at the shipped constant.
//
// The module has zero imports, so — like `attribution-reference.mjs` for
// `auto-attribution.ts` — this is a plain esbuild transpile, borrowed from the
// `api` package rather than bundled by hand.
//
// Usage:
//   node scripts/split-reference.mjs --pieces <pcm16le.raw> <sampleRate>
//     Emits { pauses: Span[], pieces: Span[] } for one turn's raw PCM16LE
//     mono audio (no WAV header — the caller already has the sample rate).
//
//   node scripts/split-reference.mjs --group <judged.json>
//     Input JSON: { pieces: [{ startMs, endMs, vector: number[] | null }] }
//     Emits { runs: [[first, last], ...] } — `groupByVoice`'s real output at
//     the shipped `SPLIT_COSINE`, index ranges into the input `pieces` array.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(BENCH_ROOT, '..', '..');
const SOURCE = resolve(REPO_ROOT, 'apps/api/src/modules/translate/session/speaker-change-split.ts');
const CACHE_DIR = resolve(BENCH_ROOT, '.cache');

/**
 * Transpile the real split planner into `.cache/`, then import it.
 *
 * Same arrangement and the same reason as `attribution-reference.mjs`'s
 * `loadClusterer`: esbuild is borrowed rather than reimplemented, and the
 * mtime check skips the transpile once the cache is fresh — this script runs
 * once per turn across five conversations plus three constant sweeps.
 */
async function loadSplitter() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const out = resolve(CACHE_DIR, 'speaker-change-split.mjs');
  const cacheIsFresh = existsSync(out) && statSync(out).mtimeMs >= statSync(SOURCE).mtimeMs;

  if (!cacheIsFresh) {
    try {
      execFileSync(
        'pnpm',
        [
          '--filter',
          'api',
          'exec',
          'esbuild',
          SOURCE,
          '--format=esm',
          `--outdir=${CACHE_DIR}`,
          '--out-extension:.js=.mjs',
          '--log-level=warning',
        ],
        { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } catch (cause) {
      throw new Error(
        'Could not transpile speaker-change-split.ts with esbuild.\n' +
          'This bench borrows esbuild from the api package. Try:\n' +
          '  pnpm install\n' +
          '  pnpm --filter api exec esbuild --version',
        { cause },
      );
    }
  }

  if (!existsSync(out)) throw new Error(`esbuild produced no output at ${out}`);
  return import(pathToFileURL(out).href);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runPieces(pcmPath, sampleRateArg) {
  const { findInternalPauses, piecesBetween } = await loadSplitter();
  const sampleRate = Number(sampleRateArg);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`bad sample rate: ${sampleRateArg}`);
  }
  const pcm = readFileSync(pcmPath);
  const pauses = findInternalPauses(pcm, sampleRate);
  const durationMs = Math.floor((pcm.length / 2 / sampleRate) * 1000);
  const pieces = piecesBetween(durationMs, pauses);
  return { pauses, pieces };
}

async function runGroup(inputPath) {
  const { groupByVoice } = await loadSplitter();
  const { pieces } = JSON.parse(readFileSync(inputPath, 'utf8'));
  const runs = groupByVoice(pieces);
  return { runs };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--pieces') {
    const [, pcmPath, sampleRate] = args;
    if (!pcmPath || !sampleRate) {
      process.stderr.write(
        'usage: node scripts/split-reference.mjs --pieces <pcm16le.raw> <sampleRate>\n',
      );
      process.exit(2);
    }
    writeJson(await runPieces(pcmPath, sampleRate));
    return;
  }

  if (args[0] === '--group') {
    const [, inputPath] = args;
    if (!inputPath) {
      process.stderr.write('usage: node scripts/split-reference.mjs --group <judged.json>\n');
      process.exit(2);
    }
    writeJson(await runGroup(inputPath));
    return;
  }

  process.stderr.write(
    'usage: node scripts/split-reference.mjs --pieces <pcm16le.raw> <sampleRate>\n' +
      '       node scripts/split-reference.mjs --group <judged.json>\n',
  );
  process.exit(2);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
