// Score an arm against the baseline, turn by turn, and say whether a
// conversation state is worth building.
//
//   node benchmarks/conversation-context/score.mjs \
//     --baseline results/baseline-r1,results/baseline-r2,results/baseline-r3 \
//     --arm results/oracle-r1,results/oracle-r2,results/oracle-r3 [--no-chrf]
//
// Reads `rows.jsonl` from each directory, writes Markdown to stdout, never
// writes to disk (a scorer that writes into recorded results is how a smoke
// run corrupts a real one).
//
// Measured per turn, averaged over a run's repeats, then compared as paired
// per-turn deltas, because DeepSeek pins temperature to 1.0 with thinking off
// and only repeats separate a real difference from sampling noise:
//
// - term rendering: did each of the turn's terms come out as the user's
//   `mustMatch` says (`scoreRow` from `error-analysis/term-rendering.mjs`);
// - chrF++ against the user's reference (sacrebleu, through `chrf.py`);
// - anchoring flips: an anchoring-control turn whose output matched the wrong
//   sense its `mustNotMatch` names.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreRow } from '../error-analysis/term-rendering.mjs';
import { BUCKETS, HERE, isControl, readJsonl, rowKey } from './corpus.mjs';

/** Every repeat's rows, one array per directory. */
export const loadRuns = (dirs) => dirs.map((dir) => readJsonl(join(dir, 'rows.jsonl')));

/** The share of a row's terms rendered as expected; null for a row with none. */
export function termShare(row) {
  const terms = row.terms ?? [];
  if (!terms.length) return null;
  const hypothesis = row.error ? '' : row.hypothesis;
  const passed = terms.filter(
    (term) => scoreRow({ id: term.source, mustMatch: term.mustMatch, hypothesis }).pass,
  ).length;
  return passed / terms.length;
}

/** Per row, the mean of `metric` over the repeats that produced it. */
export function perRowMean(runs, metric) {
  const sums = new Map();
  for (const rows of runs) {
    for (const row of rows) {
      const value = metric(row);
      if (value === null || value === undefined) continue;
      const key = rowKey(row);
      const entry = sums.get(key) ?? { sum: 0, n: 0, bucket: row.bucket };
      entry.sum += value;
      entry.n += 1;
      sums.set(key, entry);
    }
  }
  return new Map([...sums].map(([key, e]) => [key, { value: e.sum / e.n, bucket: e.bucket }]));
}

/** Term-render accuracy pooled over every term of every repeat, overall and per bucket. */
export function termAccuracy(runs) {
  const tally = { all: { passed: 0, total: 0 } };
  for (const bucket of BUCKETS) tally[bucket] = { passed: 0, total: 0 };
  for (const rows of runs) {
    for (const row of rows) {
      const share = termShare(row);
      if (share === null) continue;
      const n = row.terms.length;
      for (const slot of [tally.all, tally[row.bucket]]) {
        slot.passed += share * n;
        slot.total += n;
      }
    }
  }
  const rate = ({ passed, total }) => (total ? passed / total : null);
  return Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, rate(v)]));
}

/** Paired deltas (arm − baseline) over the rows both sides measured. */
export function pairedDeltas(base, arm, bucket = null) {
  const deltas = [];
  for (const [key, a] of arm) {
    const b = base.get(key);
    if (!b || (bucket && a.bucket !== bucket)) continue;
    deltas.push(a.value - b.value);
  }
  return deltas;
}

/** A small seeded PRNG, so a recorded CI can be reproduced exactly. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean of the deltas and its 95% bootstrap interval. */
export function bootstrap(deltas, { resamples = 10000, seed = 0 } = {}) {
  if (!deltas.length) return { n: 0, mean: null, low: null, high: null };
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const random = mulberry32(seed);
  const means = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i += 1) sum += deltas[Math.floor(random() * deltas.length)];
    means.push(sum / deltas.length);
  }
  means.sort((x, y) => x - y);
  return {
    n: deltas.length,
    mean,
    low: means[Math.floor(0.025 * resamples)],
    high: means[Math.ceil(0.975 * resamples) - 1],
  };
}

/** Anchoring-control outputs that took the wrong sense, over every repeat. */
export function anchoringFlips(runs) {
  let flips = 0;
  let total = 0;
  for (const rows of runs) {
    for (const row of rows.filter(isControl)) {
      total += 1;
      if (!row.error && new RegExp(row.mustNotMatch, 'u').test(row.hypothesis)) flips += 1;
    }
  }
  return { flips, total };
}

/**
 * GO only when all three hold: the term gain is real (its CI excludes zero on
 * the positive side), later turns gain at least as much as early ones (the
 * point of remembering a conversation), and no more anchoring controls flip.
 */
export function verdict({ termCi, gainLate, gainEarly, flipsArm, flipsBase }) {
  if (gainLate === null || gainEarly === null || termCi.n === 0) return 'UNDECIDED';
  const real = termCi.mean > 0 && termCi.low > 0;
  return real && gainLate >= gainEarly && flipsArm <= flipsBase ? 'GO' : 'NO-GO';
}

/** chrF++ per row and repeat, keyed like the rows, computed in one sacrebleu call. */
function chrfMetric(runs) {
  const pairs = [];
  for (const rows of runs) {
    for (const row of rows) {
      if (typeof row.reference !== 'string' || !row.reference.trim()) {
        throw new Error(
          `${row.conv}#${row.pos} has no reference; score a terms-only run with --no-chrf`,
        );
      }
      pairs.push({ hyp: row.error ? '' : row.hypothesis, ref: row.reference });
    }
  }
  const run = spawnSync(
    'uv',
    ['run', '--no-project', '--with', 'sacrebleu>=2.4', 'python', '-I', join(HERE, 'chrf.py')],
    { input: JSON.stringify(pairs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`chrf.py failed: ${run.stderr.trim()}`);
  const scores = JSON.parse(run.stdout);
  const byRow = new Map();
  let i = 0;
  for (const rows of runs) for (const row of rows) byRow.set(row, scores[i++]);
  return (row) => byRow.get(row);
}

const fmt = (x, digits = 3) => (x === null ? 'n/a' : x.toFixed(digits));
const ci = (c, digits = 3) =>
  c.n ? `${fmt(c.mean, digits)} [${fmt(c.low, digits)}, ${fmt(c.high, digits)}] (n=${c.n})` : 'n/a';

export function report(baseRuns, armRuns, { chrf = true } = {}) {
  const baseTerms = termAccuracy(baseRuns);
  const armTerms = termAccuracy(armRuns);
  const baseShare = perRowMean(baseRuns, termShare);
  const armShare = perRowMean(armRuns, termShare);
  const termCi = bootstrap(pairedDeltas(baseShare, armShare));
  const gain = (bucket) =>
    armTerms[bucket] === null || baseTerms[bucket] === null
      ? null
      : armTerms[bucket] - baseTerms[bucket];
  const flipsBase = anchoringFlips(baseRuns);
  const flipsArm = anchoringFlips(armRuns);

  const lines = [
    '# Conversation context: arm against baseline',
    '',
    `runs: baseline ${baseRuns.length}, arm ${armRuns.length}`,
    '',
    '| | baseline | arm | gain |',
    '|---|---|---|---|',
  ];
  for (const bucket of ['all', ...BUCKETS]) {
    lines.push(
      `| term accuracy, ${bucket} | ${fmt(baseTerms[bucket])} | ${fmt(armTerms[bucket])} | ${fmt(gain(bucket))} |`,
    );
  }
  lines.push(
    `| anchoring flips | ${flipsBase.flips}/${flipsBase.total} | ${flipsArm.flips}/${flipsArm.total} | |`,
    '',
    `term share per turn, arm − baseline, mean [95% CI]: ${ci(termCi)}`,
  );

  if (chrf) {
    const baseChrf = perRowMean(baseRuns, chrfMetric(baseRuns));
    const armChrf = perRowMean(armRuns, chrfMetric(armRuns));
    lines.push(
      `chrF++ per turn, arm − baseline, mean [95% CI]: ${ci(bootstrap(pairedDeltas(baseChrf, armChrf)), 2)}`,
    );
    for (const bucket of BUCKETS) {
      lines.push(`  ${bucket}: ${ci(bootstrap(pairedDeltas(baseChrf, armChrf, bucket)), 2)}`);
    }
  }

  const decision = verdict({
    termCi,
    gainLate: gain('16+'),
    gainEarly: gain('1-5'),
    flipsArm: flipsArm.flips / (flipsArm.total || 1),
    flipsBase: flipsBase.flips / (flipsBase.total || 1),
  });
  lines.push(
    '',
    decision,
    `- term gain CI: ${ci(termCi)}`,
    `- gain in 16+ vs 1-5: ${fmt(gain('16+'))} vs ${fmt(gain('1-5'))}`,
    `- anchoring flips, arm vs baseline: ${flipsArm.flips}/${flipsArm.total} vs ${flipsBase.flips}/${flipsBase.total}`,
    '',
  );
  return lines.join('\n');
}

function dirsFrom(argv, flag) {
  const at = argv.indexOf(flag);
  if (at < 0 || !argv[at + 1]) throw new Error(`${flag} <dir,dir,…> is required`);
  return argv[at + 1].split(',');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.stdout.write(
    report(loadRuns(dirsFrom(argv, '--baseline')), loadRuns(dirsFrom(argv, '--arm')), {
      chrf: !argv.includes('--no-chrf'),
    }),
  );
}
