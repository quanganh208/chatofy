// Is one minutes run better or worse than another, beyond noise?
//
//   node benchmarks/minutes-quality/score.mjs <baseline-dir> <candidate-dir> [--gate]
//
// Reads the two `summary.json` files and nothing else, and writes nothing: a
// scorer that wrote into a results dir is how a recorded number got rewritten
// before. Rows are paired on (id, repeat) — the same conversation, the same
// draw — and the 95% interval is a bootstrap over those paired deltas, with a
// fixed seed so the same two runs always print the same numbers.
//
// The gate is a regression tripwire, not a ranking: with this few items the
// interval is wide, so it fails only on a change that is provably worse.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIELDS = [
  'usefulness',
  'faithfulness',
  'coverage',
  'language',
  'speakerAttribution',
  'hallucinations',
];
const RESAMPLES = 10_000;
/** Usefulness may drop by at most this much at the CI's lower bound. */
const USEFULNESS_FLOOR = -0.5;

/** mulberry32: small, seeded, and enough for a bootstrap. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean of the deltas and its 95% percentile interval. */
function bootstrap(deltas) {
  const n = deltas.length;
  const mean = deltas.reduce((a, b) => a + b, 0) / n;
  const random = prng(1);
  const means = new Float64Array(RESAMPLES);
  for (let r = 0; r < RESAMPLES; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(random() * n)];
    means[r] = sum / n;
  }
  means.sort();
  return {
    mean,
    lo: means[Math.floor(RESAMPLES * 0.025)],
    hi: means[Math.floor(RESAMPLES * 0.975)],
  };
}

const load = (dir) => JSON.parse(readFileSync(resolve(dir, 'summary.json'), 'utf8'));
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

function report(label, pairs) {
  const out = {};
  console.log(`\n${label} (${pairs.length} pairs)`);
  if (!pairs.length) return out;
  for (const field of FIELDS) {
    const deltas = pairs.map(([a, b]) => b[field] - a[field]).filter(Number.isFinite);
    if (!deltas.length) continue;
    const ci = bootstrap(deltas);
    out[field] = ci;
    console.log(`  ${field.padEnd(18)} ${fmt(ci.mean)} [${fmt(ci.lo)}, ${fmt(ci.hi)}]`);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const gate = argv.includes('--gate');
  const dirs = argv.filter((a) => a !== '--gate');
  if (dirs.length !== 2) {
    console.error('usage: score.mjs <baseline-dir> <candidate-dir> [--gate]');
    process.exit(2);
  }
  const [base, cand] = dirs.map(load);
  console.log(
    `baseline  ${base.arm} ${base.models.join(',')} prompt ${base.promptSha256.slice(0, 12)}`,
  );
  console.log(
    `candidate ${cand.arm} ${cand.models.join(',')} prompt ${cand.promptSha256.slice(0, 12)}`,
  );
  if (base.corpus.realSha256 !== cand.corpus.realSha256) {
    console.error('WARNING corpus differs');
    process.exit(2);
  }
  if (base.judgeSystemSha256 !== cand.judgeSystemSha256 || base.judgeModel !== cand.judgeModel) {
    console.error('WARNING judge differs');
    process.exit(2);
  }

  const byKey = new Map(base.rows.filter((r) => !r.error).map((r) => [`${r.id}|${r.repeat}`, r]));
  const pairs = cand.rows
    .filter((r) => !r.error && byKey.has(`${r.id}|${r.repeat}`))
    .map((r) => [byKey.get(`${r.id}|${r.repeat}`), r]);
  console.log(`pairs: ${pairs.length}`);

  const all = report('all', pairs);
  report(
    'synthetic',
    pairs.filter(([, b]) => b.kind === 'synthetic'),
  );
  report(
    'real',
    pairs.filter(([, b]) => b.kind === 'real'),
  );

  if (!gate) return;
  const reasons = [];
  if (!all.usefulness || all.usefulness.lo < USEFULNESS_FLOOR) {
    reasons.push(
      `usefulness lower bound ${all.usefulness ? fmt(all.usefulness.lo) : 'n/a'} < ${USEFULNESS_FLOOR}`,
    );
  }
  if (!all.hallucinations || all.hallucinations.lo > 0) {
    reasons.push(
      `hallucinations provably up (lower bound ${all.hallucinations ? fmt(all.hallucinations.lo) : 'n/a'})`,
    );
  }
  if (reasons.length) {
    console.log(`\nGATE FAIL: ${reasons.join('; ')}`);
    process.exit(1);
  }
  console.log('\nGATE PASS');
}

main();
