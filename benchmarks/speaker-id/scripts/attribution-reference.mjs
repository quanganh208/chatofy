// Parity oracle: the REAL shipped clusterer, driven offline over a vector list.
//
// `packages/realtime-client/src/state/auto-attribution.ts` is a hand port of
// `speaker_bench/online.py`. Every threshold the client ships was calibrated by
// the Python side, so a silent drift between them would mean the product runs an
// algorithm the bench has never measured — and nothing would say so. The numbers
// would still look calibrated.
//
// This is the same arrangement `gate-reference.mjs` already uses for the speech
// gate, and for the same reason: both sides must run the same algorithm on the
// same input for a tolerance to mean anything.
//
// The direction is deliberate. Here the TYPESCRIPT is the port and the PYTHON is
// the reference — the opposite of the speech gate, where production came first.
// So this script drives the shipped TypeScript and the test compares it against
// `OnlineAttributor`, which is what the published numbers were measured with.
//
// `auto-attribution.ts` has zero imports, so this is a plain transpile rather
// than a bundle. It is not loaded from the package index on purpose: the index
// pulls in the whole client, and a parity oracle that depends on the socket
// layer would break for reasons that have nothing to do with parity.
//
// Usage:
//   node scripts/attribution-reference.mjs <vectors.json>
//
// Input JSON: { tauAssign, tauNew, kMax, mintConfirmations, vectors: number[][] }
// Emits JSON to stdout:
//   { assignments: [{ index, created, score, nearest }], clusters, turns, promotedTurns }

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(BENCH_ROOT, '..', '..');
const SOURCE = resolve(REPO_ROOT, 'packages/realtime-client/src/state/auto-attribution.ts');
const CACHE_DIR = resolve(BENCH_ROOT, '.cache');

/**
 * Transpile the real clusterer into `.cache/`, then import it.
 *
 * esbuild is borrowed from the realtime-client package, exactly as
 * `gate-reference.mjs` borrows it — benchmarks here carry no package.json by
 * convention. If it stops resolving this fails loudly with the fix rather than
 * falling back to a hand-written copy, which is the one thing a parity oracle
 * must never do.
 */
async function loadClusterer() {
  mkdirSync(CACHE_DIR, { recursive: true });
  try {
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@chatofy/realtime-client',
        'exec',
        'esbuild',
        SOURCE,
        '--format=esm',
        `--outdir=${CACHE_DIR}`,
        // This directory has no package.json, so .js output would be loaded as
        // CommonJS and fail.
        '--out-extension:.js=.mjs',
        '--log-level=warning',
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch (cause) {
    throw new Error(
      'Could not transpile auto-attribution.ts with esbuild.\n' +
        'This bench borrows esbuild from @chatofy/realtime-client. Try:\n' +
        '  pnpm install\n' +
        '  pnpm --filter @chatofy/realtime-client exec esbuild --version',
      { cause },
    );
  }

  const out = resolve(CACHE_DIR, 'auto-attribution.mjs');
  if (!existsSync(out)) throw new Error(`esbuild produced no output at ${out}`);
  return import(pathToFileURL(out).href);
}

async function main() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write('usage: node scripts/attribution-reference.mjs <vectors.json>\n');
    process.exit(2);
  }

  const { observeVoice, promoteProvisional, EMPTY_AUTO_ATTRIBUTION } = await loadClusterer();
  const { tauAssign, tauNew, kMax, mintConfirmations, vectors } = JSON.parse(
    readFileSync(inputPath, 'utf8'),
  );
  const config = { tauAssign, tauNew, kMax, mintConfirmations };

  let state = EMPTY_AUTO_ATTRIBUTION;
  const assignments = [];
  for (const vector of vectors) {
    const step = observeVoice(state, vector, config);
    state = step.state;
    assignments.push(step.assignment);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        assignments,
        clusters: state.clusters.length,
        // Turns per cluster, so a port that places every turn correctly while
        // folding the wrong ones into a centroid still fails.
        turns: state.clusters.map((cluster) => cluster.turns),
        // The same, after the session-end promotion settling runs.
        promotedTurns: promoteProvisional(state, config).state.clusters.map(
          (cluster) => cluster.turns,
        ),
      },
      // `JSON.stringify` turns ±Infinity into `null`, and the first turn of every
      // conversation scores -Infinity — the sentinel for "nothing to compare
      // against". Left alone, the parity check would silently stop comparing the
      // one field that distinguishes "no evidence" from "a cosine of zero".
      (_key, value) =>
        typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
