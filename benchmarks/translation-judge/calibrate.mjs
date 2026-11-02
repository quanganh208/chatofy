// Does the judge find errors that are known to be there, and only those?
//
//   node calibrate.mjs --clean results/<clean run> --perturbed results/<perturbed run> \
//     --set data/calibration-perturbed.jsonl
//
// Three numbers, three bounds, all of which must hold before any error table
// from this judge is read:
//   - recall: a broken copy draws a serious error the judge blames on the
//     translation (origin `mt`), per rule and overall, ≥ 0.80. Blaming it on
//     hearing is a miss: telling the two apart is what the ruler is for;
//   - clean flags: candidates heard right that draw a serious error, ≤ 0.10.
//     An upper bound on false alarms, since a candidate's translation can be
//     genuinely wrong; flagged rows are listed for reading;
//   - agreement: turns whose repeats give the same label by majority, ≥ 0.80.
import { fileURLToPath } from 'node:url';

import { consensus, loadJudgements } from './consensus.mjs';
import { readJsonl } from './rows.mjs';

export const GATE = { recall: 0.8, cleanFlags: 0.1, agreement: 0.8 };

function share(hits, total) {
  return total ? hits / total : null;
}

/** The three calibration numbers from judged clean and broken rows. */
export function calibrate(cleanById, brokenById, brokenSet) {
  const clean = [...cleanById].filter(([, answers]) => answers.length >= 2);
  const cleanFlagged = clean
    .filter(([, answers]) => consensus(answers).keys.has('any'))
    .map(([id]) => id);

  const recall = {};
  let hits = 0;
  let total = 0;
  const misses = [];
  for (const row of brokenSet) {
    const answers = brokenById.get(row.id);
    if (!answers || answers.length < 2) continue;
    const keys = consensus(answers).keys;
    recall[row.kind] ??= { hits: 0, total: 0, blamedOnHearing: 0 };
    recall[row.kind].total += 1;
    total += 1;
    if (keys.has('mt')) {
      recall[row.kind].hits += 1;
      hits += 1;
    } else {
      if (keys.has('asr')) recall[row.kind].blamedOnHearing += 1;
      misses.push(row.id);
    }
  }

  const all = [
    ...clean.map(([, answers]) => answers),
    ...[...brokenById.values()].filter((a) => a.length >= 2),
  ];
  const agreed = all.filter((answers) => consensus(answers).agreed).length;

  const numbers = {
    recall: share(hits, total),
    recallByKind: Object.fromEntries(
      Object.entries(recall).map(([kind, r]) => [kind, { ...r, recall: share(r.hits, r.total) }]),
    ),
    perturbed: total,
    cleanFlags: share(cleanFlagged.length, clean.length),
    clean: clean.length,
    agreement: share(agreed, all.length),
    judged: all.length,
    cleanFlagged,
    misses,
  };
  numbers.pass =
    numbers.recall !== null &&
    numbers.recall >= GATE.recall &&
    numbers.cleanFlags !== null &&
    numbers.cleanFlags <= GATE.cleanFlags &&
    numbers.agreement !== null &&
    numbers.agreement >= GATE.agreement;
  return numbers;
}

const pct = (x) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  const clean = loadJudgements(flag('--clean'));
  const broken = loadJudgements(flag('--perturbed'));
  if (clean.model !== broken.model)
    throw new Error(`clean run is ${clean.model}, perturbed is ${broken.model}`);
  const n = calibrate(clean.byId, broken.byId, readJsonl(flag('--set')));
  const lines = [
    `# Judge calibration: ${clean.model}`,
    '',
    `| bound | value | gate |`,
    `| --- | --- | --- |`,
    `| recall (origin mt), n=${n.perturbed} | ${pct(n.recall)} | ≥ ${pct(GATE.recall)} |`,
    `| clean flags, n=${n.clean} | ${pct(n.cleanFlags)} | ≤ ${pct(GATE.cleanFlags)} |`,
    `| agreement, n=${n.judged} | ${pct(n.agreement)} | ≥ ${pct(GATE.agreement)} |`,
    '',
    '| rule | caught | of | blamed on hearing |',
    '| --- | --- | --- | --- |',
    ...Object.entries(n.recallByKind).map(
      ([kind, r]) => `| ${kind} | ${r.hits} | ${r.total} | ${r.blamedOnHearing} |`,
    ),
    '',
    `Clean rows flagged: ${n.cleanFlagged.join(', ') || 'none'}`,
    `Broken rows missed: ${n.misses.join(', ') || 'none'}`,
    '',
    n.pass ? 'GATE PASS' : 'GATE FAIL',
  ];
  console.log(lines.join('\n'));
}
