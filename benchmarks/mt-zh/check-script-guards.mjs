// Replay recorded MT outputs through the SHIPPED script guards.
//
//   node benchmarks/mt-zh/check-script-guards.mjs benchmarks/mt-zh/results/261013-deepseek-flash-r3
//
// Two questions, both answered against the built `packages/ai-providers`:
//
// 1. Does `toTargetScript('zh', …)` leave no Traditional Chinese? Counted by an
//    INDEPENDENT detector, `hanzidentifier` (CC-CEDICT tables), before and after
//    conversion — never by "t2s would change it", which is the converter
//    grading itself. The before count shows the detector sees what `score.py`
//    saw.
// 2. Does `leaksForeignScript` flag the recorded zh→vi switches into Chinese,
//    and nothing in en→vi, zh→en or vi→en?
//
// Costs nothing and calls no model. Exits 1 when either answer is wrong.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const { leaksForeignScript, toTargetScript } = await import(
  join(REPO, 'packages/ai-providers', 'dist', 'index.js')
);

/** Pinned so a detector update cannot move the count under the same command. */
const HANZIDENTIFIER = 'hanzidentifier==1.3.0';

const dir = process.argv[2];
if (!dir) throw new Error('usage: check-script-guards.mjs <results dir>');

const read = (direction) =>
  readFileSync(join(dir, `${direction}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => !row.error);

/** How many texts `hanzidentifier` reads as Traditional or mixed-with-Traditional. */
function traditionalCount(texts) {
  const script =
    'import json, sys, hanzidentifier as h\n' +
    'texts = json.load(sys.stdin)\n' +
    'print(sum(h.identify(t) in (h.TRADITIONAL, h.MIXED) for t in texts))';
  const out = execFileSync(
    'uv',
    ['run', '--no-project', '--quiet', '--with', HANZIDENTIFIER, 'python', '-c', script],
    { input: JSON.stringify(texts), encoding: 'utf8' },
  );
  return Number(out.trim());
}

let failed = false;

// ── 1. Simplified output ─────────────────────────────────────────────────────
const zhOutputs = ['vi_to_zh', 'en_to_zh'].flatMap(read).map((row) => row.hypothesis);
const before = traditionalCount(zhOutputs);
const after = traditionalCount(zhOutputs.map((text) => toTargetScript('zh', text)));
console.log(`zh outputs: ${zhOutputs.length}`);
console.log(`  Traditional before toTargetScript: ${before}`);
console.log(`  Traditional after toTargetScript:  ${after}`);
if (after !== 0) failed = true;

// ── 2. Foreign-script leaks ──────────────────────────────────────────────────
for (const direction of ['zh_to_vi', 'en_to_vi', 'zh_to_en', 'vi_to_en']) {
  const [source, target] = direction.split('_to_');
  const rows = read(direction);
  const flagged = rows.filter((row) =>
    leaksForeignScript(source, target, row.source, row.hypothesis),
  );
  console.log(
    `${direction}: ${flagged.length}/${rows.length} flagged` +
      (flagged.length ? ` (${flagged.map((r) => `${r.id} r${r.repeat}`).join(', ')})` : ''),
  );
  if (direction === 'zh_to_vi') {
    const ids = new Set(flagged.map((r) => `${r.id} r${r.repeat}`));
    for (const expected of ['1992 r1', '1896 r2']) {
      if (!ids.has(expected)) {
        console.log(`  MISSED recorded leak ${expected}`);
        failed = true;
      }
    }
  } else if (flagged.length > 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
