// Held-out RECALL for the ITN, on text it has never seen.
//
//     node scripts/itn_roundtrip_recall.mjs
//
// The 22-utterance display corpus is in-sample twice over — the shipped repair
// prompt was revised against it and the ITN was built while reading it — so its
// recall figure is feasibility evidence, not an estimate. The held-out negative
// sets (`itn_holdout_check.mjs`) fix that for hallucination but can say nothing
// about recall, because neither VIVOS nor LibriSpeech references contain a
// single digit.
//
// This closes that gap the only way available without recording new audio:
// written sentences carrying numerals, verbalized by hand into the form a
// speaker would say, then typeset back. The ITN's input is recognizer TEXT, so
// held-out text is legitimately held-out data FOR THE FUNCTION.
//
// **The limitation, which must be stated wherever this number is quoted: these
// contain no ASR errors.** Real decoder output is misspelled, mis-segmented and
// occasionally a different word — `nghỉ` came out as `nghìn` in the spoken
// corpus. So this measures the grammar, not the pipeline, and it is weaker
// evidence than a spoken set would be. It is reported separately from the
// in-sample figure for that reason, never merged into "validated on held-out
// data".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inverseNormalizeTranscript } from '../../../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, '..', 'data/itn-roundtrip.jsonl');
const NUMERAL = /\d+(?:[.,:/]\d+)*/g;

const rows = readFileSync(CORPUS, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const totals = new Map();

for (const row of rows) {
  const produced = inverseNormalizeTranscript(row.spoken, row.language);
  const wanted = row.written.match(NUMERAL) ?? [];
  const got = produced.match(NUMERAL) ?? [];

  const remaining = [...wanted];
  const extra = [];
  for (const numeral of got) {
    const at = remaining.indexOf(numeral);
    if (at >= 0) remaining.splice(at, 1);
    else extra.push(numeral);
  }

  const bucket = totals.get(row.language) ?? { matched: 0, total: 0, extra: 0, rows: 0 };
  bucket.matched += got.length - extra.length;
  bucket.total += wanted.length;
  bucket.extra += extra.length;
  bucket.rows += 1;
  totals.set(row.language, bucket);

  if (remaining.length || extra.length) {
    console.log(`\n✗ ${row.id}`);
    console.log(`  spoken  : ${row.spoken}`);
    console.log(`  itn     : ${produced}`);
    console.log(`  written : ${row.written}`);
    if (remaining.length) console.log(`  missing ${JSON.stringify(remaining)}`);
    if (extra.length) console.log(`  EXTRA   ${JSON.stringify(extra)}`);
  }
}

console.log('\n=== ITN ROUND-TRIP RECALL (held-out TEXT — contains no ASR errors) ===');
let failed = 0;
for (const [language, bucket] of totals) {
  console.log(
    `  ${language}  recall ${(bucket.matched / bucket.total).toFixed(4)}` +
      ` (${bucket.matched}/${bucket.total})  hallucinations ${bucket.extra}` +
      `  over ${bucket.rows} sentences`,
  );
  if (bucket.extra > 0) failed = 1;
}
console.log();
process.exit(failed);
