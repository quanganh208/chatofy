// The held-out negative gate: run the ITN over utterances it was never built
// against, and show a human every digit it decided to write.
//
//     node scripts/itn_holdout_check.mjs                  # vi, review the diff
//     node scripts/itn_holdout_check.mjs --language en
//     node scripts/itn_holdout_check.mjs --approve        # snapshot the reviewed rows
//
// **This set cannot score recall and is not trying to.** The 50 VIVOS
// references carry zero digits, as do the 50 moonshine ones, so there is nothing
// for a correct numeral to match. What they can do is far more valuable: they
// are ordinary speech the implementation has never seen, so every digit that
// appears here is a decision to explain. Some are right — `hai mươi` really is
// 20 — and the rest are exactly the failure this whole design exists to prevent.
// Only a person can tell those apart, which is why this prints a diff instead of
// a pass/fail number.
//
// **The snapshot is what keeps the review honest.** This phase expects to loop,
// and every iteration would otherwise invalidate a 50-row manual review — or,
// worse, let one quietly re-approve itself by being re-run. With
// `data/display-itn-holdout-approved.jsonl` checked in, only rows whose output
// CHANGED come back for review, and the same artifact becomes the durable CI
// regression gate for any later change to the ITN. That is the only thing that
// keeps this gate alive after the thesis.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inverseNormalizeTranscript } from '../../../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(HERE, '..');

const SOURCES = {
  vi: 'results/r1/sherpa-zipformer-vi.jsonl',
  en: 'results/r1/sherpa-moonshine-en.jsonl',
};

const APPROVED = resolve(BENCH, 'data/display-itn-holdout-approved.jsonl');
const NUMERAL = /\d+(?:[.,:/]\d+)*/g;

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function main() {
  const language = argument('language', 'vi');
  const approve = process.argv.includes('--approve');
  const source = resolve(BENCH, argument('source', SOURCES[language]));

  const utterances = readJsonl(source).filter((row) => row.type !== 'header');

  // Both sides are scored. The REFERENCE is what was actually said, so a digit
  // there is the ITN's own decision with no recognizer error to hide behind; the
  // HYPOTHESIS is what the ITN will really be handed in production, mistakes
  // included. A rule that is safe on clean text and not on decoder output is
  // still unsafe.
  const rows = [];
  for (const utterance of utterances) {
    for (const [side, text] of [
      ['ref', utterance.ref_text],
      ['hyp', utterance.hyp_text],
    ]) {
      if (!text) continue;
      const itn = inverseNormalizeTranscript(text, language);
      if (itn === text) continue;
      rows.push({
        id: `${utterance.utt_id}:${side}`,
        language,
        source: text,
        itn,
        numerals: itn.match(NUMERAL) ?? [],
      });
    }
  }

  const previous = new Map(
    existsSync(APPROVED)
      ? readJsonl(APPROVED)
          .filter((row) => row.language === language)
          .map((row) => [row.id, row])
      : [],
  );

  const changed = rows.filter((row) => previous.get(row.id)?.itn !== row.itn);
  const vanished = [...previous.keys()].filter((id) => !rows.some((row) => row.id === id));

  console.log(
    `\n=== ITN HELD-OUT CHECK · ${language} · ${utterances.length} utterances ===\n` +
      `  ${rows.length} of ${utterances.length * 2} sides changed by the ITN\n` +
      `  ${changed.length} need review · ${vanished.length} no longer produced\n`,
  );

  for (const row of changed) {
    console.log(`--- ${row.id}   ${JSON.stringify(row.numerals)}`);
    console.log(`  said : ${row.source}`);
    console.log(`  itn  : ${row.itn}`);
    const was = previous.get(row.id);
    if (was) console.log(`  WAS  : ${was.itn}`);
  }
  for (const id of vanished) console.log(`--- ${id} no longer changed by the ITN`);

  if (approve) {
    const others = existsSync(APPROVED)
      ? readJsonl(APPROVED).filter((row) => row.language !== language)
      : [];
    const snapshot = [...others, ...rows.map(({ numerals, ...row }) => row)];
    writeFileSync(APPROVED, snapshot.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
    console.log(
      `\n  approved ${rows.length} ${language} rows -> data/display-itn-holdout-approved.jsonl\n`,
    );
    return 0;
  }

  if (changed.length || vanished.length) {
    console.log(
      `\n  ${changed.length + vanished.length} rows need a human. Re-run with --approve once reviewed.\n`,
    );
    return 1;
  }
  console.log('  every row matches the approved snapshot\n');
  return 0;
}

process.exit(main());
