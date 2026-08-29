// Typeset the display-fidelity set through the SHIPPING ITN, and report what it
// produced.
//
// Step 2 of 3; see `dump_display_hypotheses.py` for the sequence. It replaces
// `repair_display_hypotheses.mjs`, which drove a remote model at real quota cost
// and could therefore never run in CI. This one spends nothing, needs no API
// key, and finishes in milliseconds — which is the point, and is what makes the
// display metric a permanent gate rather than a one-off measurement.
//
//     node scripts/itn_display_hypotheses.mjs [--diff]
//
// It drives `inverseNormalizeTranscript` itself rather than re-implementing the
// rules, the same discipline the repair harness followed: a harness carrying its
// own copy of the logic keeps passing after the real one has drifted, and would
// have nothing to say about production.
//
// **The row shape is deliberately NOT the repaired arm's.** Those rows carry a
// `divergence` field recording a paraphrase guard's verdict; the ITN has no
// guard, because its output is derived from the raw text by construction and
// nothing is ever withheld. Synthesizing the field to match would make the
// scorer print a "0 withheld" statistic describing a mechanism that does not
// exist. Score these with `--field itn --no-guard`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inverseNormalizeTranscript } from '../../../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(HERE, '..');

const IN = resolve(BENCH, 'data/display-hypotheses.jsonl');
const MANIFEST = resolve(BENCH, 'data/manifest-vi-display.jsonl');
const OUT = resolve(BENCH, 'data/display-itn.jsonl');

const NUMERAL = /\d+(?:[.,:/]\d+)*/g;

const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

/** Multiset comparison, matching `display_fidelity.py`'s definition exactly. */
function compare(reference, hypothesis) {
  const pool = reference.match(NUMERAL) ?? [];
  const produced = hypothesis.match(NUMERAL) ?? [];
  const remaining = [...pool];
  const extra = [];
  for (const numeral of produced) {
    const at = remaining.indexOf(numeral);
    if (at >= 0) remaining.splice(at, 1);
    else extra.push(numeral);
  }
  return { total: pool.length, matched: produced.length - extra.length, missing: remaining, extra };
}

function main() {
  const showDiff = process.argv.includes('--diff');
  const references = new Map(readJsonl(MANIFEST).map((row) => [row.id, row]));
  const rows = readJsonl(IN);

  const out = [];
  let matched = 0;
  let total = 0;
  let hallucinated = 0;
  const durations = [];

  for (const row of rows) {
    const reference = references.get(row.id);
    if (!reference) throw new Error(`no reference for ${row.id}`);
    const language = row.language ?? reference.lang ?? 'vi';

    const started = performance.now();
    const itn = inverseNormalizeTranscript(row.raw, language);
    const ms = performance.now() - started;
    durations.push(ms);

    const score = compare(reference.ref_text, itn);
    matched += score.matched;
    total += score.total;
    hallucinated += score.extra.length;

    if (showDiff && (score.missing.length || score.extra.length)) {
      console.log(`\n✗ ${row.id}`);
      console.log(`  raw : ${row.raw}`);
      console.log(`  itn : ${itn}`);
      console.log(`  ref : ${reference.ref_text}`);
      if (score.missing.length) console.log(`  missing ${JSON.stringify(score.missing)}`);
      if (score.extra.length) console.log(`  EXTRA   ${JSON.stringify(score.extra)}`);
    }

    out.push({
      id: row.id,
      raw: row.raw,
      ref_text: reference.ref_text,
      proper_nouns: reference.proper_nouns,
      language,
      itn,
      ms: Number(ms.toFixed(3)),
    });
  }

  writeFileSync(OUT, out.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

  durations.sort((a, b) => a - b);
  const p95 = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)];
  console.log(`\n  numeral recall        ${(matched / total).toFixed(4)}  (${matched}/${total})`);
  console.log(`  numeral hallucinations ${hallucinated}`);
  console.log(`  latency p95            ${p95.toFixed(3)} ms`);
  console.log(`\n  wrote ${out.length} rows -> data/display-itn.jsonl\n`);
  return hallucinated === 0 ? 0 : 1;
}

process.exit(main());
