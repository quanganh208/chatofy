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
//   node scripts/attribution-reference.mjs --pipeline <turns.json>
//
// Input JSON: { tauAssign, tauNew, kMax, mintConfirmations, vectors: number[][] }
// Emits JSON to stdout:
//   { assignments: [{ index, created, score, nearest }], clusters, turns, promotedTurns }
//
// `--pipeline` mode drives the same clusterer through the client's settle path
// instead of a bare fold-every-vector loop — see `runPipeline` below.
// Input JSON: { config: { tauAssign, tauNew, kMax, mintConfirmations },
//               turns: [{ tag, vector: number[] | null }], order?: number[] }
// Emits JSON to stdout: { labels: (number | null)[] }, one entry per input turn.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
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
 *
 * **Skips the transpile when the cache is already newer than the source.**
 * `--pipeline` mode runs one node process per meeting (`run_attribution_rulers.py`
 * scores hundreds of them per ruler), and `pnpm --filter ... exec esbuild`
 * resolving the workspace costs most of a second on its own, every time, even
 * though the source it transpiles is a handful of KB that rarely changes
 * between calls. The mtime check is the whole cache: correctness comes from
 * comparing against `SOURCE`, not from trusting a stale directory.
 */
async function loadClusterer() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const out = resolve(CACHE_DIR, 'auto-attribution.mjs');
  const cacheIsFresh = existsSync(out) && statSync(out).mtimeMs >= statSync(SOURCE).mtimeMs;

  if (!cacheIsFresh) {
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
  }

  if (!existsSync(out)) throw new Error(`esbuild produced no output at ${out}`);
  return import(pathToFileURL(out).href);
}

/**
 * Score one meeting the way the client actually settles it, mirroring
 * `turn-keyed-transcript.ts` rather than folding every vector in arrival order
 * and stopping. Three passes, each citing the line range it reproduces:
 *
 * 1. `:763-798` — observe each turn's embedding as it arrives (in `order`,
 *    turn order by default). A turn that lands on a cluster is labelled
 *    immediately; a turn that mints a voice also names the earlier turns that
 *    corroborated it while it was provisional (`members`). A turn in the dead
 *    zone is held — nothing is labelled, and nothing here revisits it, exactly
 *    as `observeVoice` never re-decides a held turn once more evidence exists.
 * 2. `:860-873` — at session end, provisional voices promote while the cap has
 *    room. Roster room is not modelled: `MAX_SPEAKERS` exceeds `kMax` (2) in
 *    the product, so the cap `promoteProvisional` enforces here is `kMax`
 *    itself, unchanged from what the loop already used.
 * 3. `:875-898` — every turn still unlabelled is resolved against the settled
 *    state: a turn with a vector takes `assignment.nearest` (a read-only
 *    `observeVoice` call — its returned state is discarded, exactly as the
 *    client's settle pass never folds a settle-time guess into a centroid); a
 *    turn with no vector (gated, or the vector never arrived) carries forward
 *    the label of the nearest earlier turn, walked in turn order.
 *
 * A turn whose vector is `null` is never observed in pass 1 — that is the gate
 * proxy: the clusterer never sees a turn under the speech floor, the same as
 * the real pipeline never calling `/embed` for one.
 */
function runPipeline(
  { observeVoice, promoteProvisional, EMPTY_AUTO_ATTRIBUTION },
  { config, turns, order },
) {
  const arrivalOrder = order && order.length > 0 ? order : turns.map((_turn, index) => index);
  const tagToIndex = new Map(
    turns.map((turn, index) => [turn.tag, index]).filter(([tag]) => tag !== undefined),
  );

  let state = EMPTY_AUTO_ATTRIBUTION;
  const labels = new Array(turns.length).fill(null);

  for (const index of arrivalOrder) {
    const vector = turns[index].vector;
    if (vector === null || vector === undefined) continue; // gated: never observed

    const step = observeVoice(state, vector, config, turns[index].tag);
    state = step.state;
    if (step.assignment.index === null) continue; // dead zone: held pending

    labels[index] = step.assignment.index;
    if (step.assignment.created) {
      const members = state.clusters[step.assignment.index]?.members ?? [];
      for (const memberTag of members) {
        const memberIndex = tagToIndex.get(memberTag);
        if (memberIndex !== undefined) labels[memberIndex] = step.assignment.index;
      }
    }
  }

  state = promoteProvisional(state, config).state;

  let carried = null;
  for (let index = 0; index < turns.length; index += 1) {
    if (labels[index] !== null) {
      carried = labels[index];
      continue;
    }
    const vector = turns[index].vector;
    const nearest =
      vector === null || vector === undefined
        ? null
        : observeVoice(state, vector, config).assignment.nearest;
    const resolved = nearest === null || nearest === undefined ? carried : nearest;
    if (resolved === null || resolved === undefined) continue; // nothing to carry from yet
    labels[index] = resolved;
    carried = resolved;
  }

  return { labels };
}

async function runReference(inputPath) {
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

  return {
    assignments,
    clusters: state.clusters.length,
    // Turns per cluster, so a port that places every turn correctly while
    // folding the wrong ones into a centroid still fails.
    turns: state.clusters.map((cluster) => cluster.turns),
    // The same, after the session-end promotion settling runs.
    promotedTurns: promoteProvisional(state, config).state.clusters.map((cluster) => cluster.turns),
  };
}

async function runPipelineFromFile(inputPath) {
  const clusterer = await loadClusterer();
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  return runPipeline(clusterer, input);
}

function writeJson(value) {
  process.stdout.write(
    `${JSON.stringify(
      value,
      // `JSON.stringify` turns ±Infinity into `null`, and the first turn of every
      // conversation scores -Infinity — the sentinel for "nothing to compare
      // against". Left alone, the parity check would silently stop comparing the
      // one field that distinguishes "no evidence" from "a cosine of zero".
      (_key, value_) =>
        typeof value_ === 'number' && !Number.isFinite(value_) ? String(value_) : value_,
      2,
    )}\n`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--pipeline') {
    const [, inputPath] = args;
    if (!inputPath) {
      process.stderr.write(
        'usage: node scripts/attribution-reference.mjs --pipeline <turns.json>\n',
      );
      process.exit(2);
    }
    writeJson(await runPipelineFromFile(inputPath));
    return;
  }

  const [inputPath] = args;
  if (!inputPath) {
    process.stderr.write('usage: node scripts/attribution-reference.mjs <vectors.json>\n');
    process.exit(2);
  }
  writeJson(await runReference(inputPath));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
