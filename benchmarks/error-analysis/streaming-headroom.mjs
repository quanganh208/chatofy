// How much of a translation arrives AFTER its first token.
//
//   node benchmarks/error-analysis/streaming-headroom.mjs results/deepseek-after.jsonl
//
// That gap is the entire prize for streaming a translation onward instead of
// waiting for it: a caller that forwards pieces as they arrive can start the
// next stage `totalMs - ttftMs` earlier, and not one millisecond more. Anything
// claimed beyond it is a claim about a different stage.
//
// Written because the question was about to be answered from a single docblock
// figure taken on ten short turns. The tail depends on how much text a turn
// produces, so a number that does not vary with length cannot answer it, and
// the buckets below are the smallest thing that can.
//
// Reads only `ttftMs`, `totalMs` and `chars`, which `translate-rows.mjs` writes
// on every arm. Like `analyze.mjs` and `glossary-adherence.mjs` it never
// translates and writes to stdout only.
import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (!paths.length) {
  throw new Error('usage: streaming-headroom.mjs <rows.jsonl> [rows.jsonl…]');
}

/** Rows that actually completed and carry timing. A failed row has no tail. */
function readTimed(path) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${err.message}`);
      }
    })
    .filter((row) => typeof row.ttftMs === 'number' && typeof row.totalMs === 'number');
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank, so a reported value is always one that was actually measured
  // rather than an interpolation between two turns that never happened.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
};

/**
 * Length buckets, in characters of OUTPUT.
 *
 * Output rather than input, because the tail is generation time and generation
 * is paid per token produced. The edges are where this product's turns actually
 * fall: `SpeechGate` cuts an utterance at 8 seconds, which is a couple of
 * sentences, so anything past ~160 characters is already the long end.
 */
const BUCKETS = [
  { label: '≤ 40 chars', max: 40 },
  { label: '41–80', max: 80 },
  { label: '81–160', max: 160 },
  { label: '> 160', max: Infinity },
];

const summarize = (rows) => {
  const tails = rows.map((row) => row.totalMs - row.ttftMs);
  const totals = rows.map((row) => row.totalMs);
  const p50Tail = percentile(tails, 50);
  const p50Total = percentile(totals, 50);
  return {
    n: rows.length,
    p50Ttft: percentile(
      rows.map((row) => row.ttftMs),
      50,
    ),
    p50Total,
    p50Tail,
    p95Tail: percentile(tails, 95),
    share: p50Total ? ((p50Tail / p50Total) * 100).toFixed(0) : '—',
  };
};

const basename = (path) => path.split('/').pop();

console.log('# Streaming headroom\n');
console.log('How much of each translation arrived after its first token. That tail is the');
console.log('most that forwarding pieces onward could save, per turn.\n');

for (const path of paths) {
  const rows = readTimed(path);
  if (!rows.length) {
    console.log(`## ${basename(path)}\n\nNo rows carry timing — re-run the arm.\n`);
    continue;
  }
  const models = [...new Set(rows.map((row) => row.model).filter(Boolean))];
  const all = summarize(rows);
  console.log(`## ${basename(path)} — ${models.join(', ') || 'unknown model'}\n`);
  console.log(
    `| Output length | Rows | p50 first token | p50 total | p50 tail | p95 tail | Tail share |`,
  );
  console.log('|---|---|---|---|---|---|---|');
  let floor = 0;
  for (const bucket of BUCKETS) {
    const inBucket = rows.filter((row) => row.chars > floor && row.chars <= bucket.max);
    floor = bucket.max;
    if (!inBucket.length) continue;
    const s = summarize(inBucket);
    console.log(
      `| ${bucket.label} | ${s.n} | ${s.p50Ttft}ms | ${s.p50Total}ms | **${s.p50Tail}ms** | ${s.p95Tail}ms | ${s.share}% |`,
    );
  }
  console.log(
    `| **all** | ${all.n} | ${all.p50Ttft}ms | ${all.p50Total}ms | **${all.p50Tail}ms** | ${all.p95Tail}ms | ${all.share}% |`,
  );
  console.log('');
}

console.log(
  'Read the tail against what a turn already spends before a listener hears\n' +
    'anything. `benchmarks/live-translate` records that as\n' +
    '`firstAudioAfterSpeechEndMs`, and it has been 1.9–3.7s on this machine. A\n' +
    'tail worth a few percent of that is inside the noise of the measurement it\n' +
    'would be trying to improve.',
);
