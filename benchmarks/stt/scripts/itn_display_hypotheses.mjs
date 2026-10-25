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
//     node scripts/itn_display_hypotheses.mjs --lang zh --manifest results/r11-zh-fleurs [--diff]
//
// `--lang zh` reads a results directory instead (Paraformer rows from
// `sherpa-paraformer-zh.jsonl`, or restored lines from `restored.jsonl`), prints
// every span the zh ITN changed for a hand review, and writes nothing: the zh
// rows are recorded benchmark results, not this script's output.
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  chineseInverseNormalize,
  inverseNormalizeTranscript,
} from '../../../packages/ai-providers/dist/index.js';

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

/** The characters the two strings do not share, as `[before, after]` hunks. */
function changedSpans(before, after) {
  const a = [...before];
  const b = [...after];
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const spans = [];
  let i = 0;
  let j = 0;
  let hunk = null;
  const flush = () => {
    if (hunk) spans.push([hunk[0], hunk[1]]);
    hunk = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      hunk ??= ['', ''];
      hunk[1] += b[j];
      j += 1;
    } else {
      hunk ??= ['', ''];
      hunk[0] += a[i];
      i += 1;
    }
  }
  flush();
  return spans;
}

/** `--lang zh`: run the shipped zh ITN over a results directory and list every change. */
function mainZh(manifest) {
  const showDiff = process.argv.includes('--diff');
  const dir = resolve(BENCH, manifest);
  const file = ['sherpa-paraformer-zh.jsonl', 'restored.jsonl']
    .map((name) => resolve(dir, name))
    .find((path) => existsSync(path));
  if (!file) throw new Error(`no sherpa-paraformer-zh.jsonl or restored.jsonl in ${dir}`);
  const rows = readJsonl(file).filter((row) => row.type === undefined || row.type === 'utterance');

  let lines = 0;
  let changedLines = 0;
  let spans = 0;
  for (const row of rows) {
    const raw = row.restored ?? row.hyp_text;
    if (typeof raw !== 'string') continue;
    lines += 1;
    const itn = chineseInverseNormalize(raw);
    if (itn === raw) continue;
    changedLines += 1;
    const changes = changedSpans(raw, itn);
    spans += changes.length;
    if (showDiff) {
      console.log(`\n~ ${row.utt_id ?? row.id}`);
      console.log(`  raw : ${raw}`);
      console.log(`  itn : ${itn}`);
      console.log(`  ref : ${row.ref_text ?? row.reference ?? ''}`);
      for (const [from, to] of changes)
        console.log(`  ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
    }
  }
  console.log(`\n  ${file}`);
  console.log(`  lines ${lines}, changed ${changedLines}, changed spans ${spans}\n`);
  return 0;
}

const langAt = process.argv.indexOf('--lang');
const lang = langAt >= 0 ? process.argv[langAt + 1] : 'vi';
const manifestAt = process.argv.indexOf('--manifest');
if (lang === 'zh') {
  if (manifestAt < 0) throw new Error('--lang zh needs --manifest <results dir>');
  process.exit(mainZh(process.argv[manifestAt + 1]));
}
process.exit(main());
