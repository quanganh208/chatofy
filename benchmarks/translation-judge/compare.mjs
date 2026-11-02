// Did a review arm make translations better than what was stored? Paired, turn by turn.
//
//   node compare.mjs --base results/full-claude-opus-5-5 --arm results/<arm run> \
//     --arm-turns data/arms/arm-<n>-<model>.jsonl
//
// The arm's judge run holds only the turns the arm REWROTE. A turn it left
// alone shows the reader the stored line, so it keeps the baseline's
// judgement: judging identical text again would only add the judge's own
// noise to the difference, and pay for it.
//
// Per direction: the share of turns with a serious `mt` error and with any
// serious error, base vs arm, and their difference with a 95% bootstrap
// interval that resamples conversations (as `score.mjs` does). Also turns
// fixed (base serious → arm clean) and broken (base clean → arm serious).
//
// Writes to stdout only.
import { fileURLToPath } from 'node:url';

import { consensus, loadJudgements } from './consensus.mjs';
import { readJsonl, turnId } from './rows.mjs';
import { mulberry32 } from './score.mjs';

const RESAMPLES = 10_000;
/** The keys a paired turn is read on: any serious error, and a serious translation error. */
export const KEYS = ['any', 'mt'];

/**
 * One record per turn present in both runs: base keys, arm keys, and the
 * arm's row facts. A rewritten turn the arm run never judged is left out,
 * and counted, rather than silently scored as the baseline.
 */
export function pairTurns(armRows, baseById, armById) {
  const turns = [];
  let missing = 0;
  for (const row of armRows) {
    const id = turnId(row);
    const base = baseById.get(id);
    if (!base || base.length < 2) continue;
    const baseKeys = consensus(base).keys;
    let armKeys = baseKeys;
    if (row.rewritten) {
      const answers = armById.get(id);
      if (!answers || answers.length < 2) {
        missing += 1;
        continue;
      }
      armKeys = consensus(answers).keys;
    }
    turns.push({
      conv: row.conv,
      direction: row.direction,
      rewritten: Boolean(row.rewritten),
      ms: row.ms,
      costUsd: row.costUsd ?? 0,
      base: baseKeys,
      arm: armKeys,
    });
  }
  return { turns, missing };
}

/** Base and arm shares for each key, and the arm-minus-base difference. */
export function pairedStats(turns) {
  const n = turns.length;
  const out = { turns: n };
  for (const key of KEYS) {
    const base = turns.filter((t) => t.base.has(key)).length;
    const arm = turns.filter((t) => t.arm.has(key)).length;
    out[`base:${key}`] = n ? base / n : null;
    out[`arm:${key}`] = n ? arm / n : null;
    out[`diff:${key}`] = n ? (arm - base) / n : null;
    out[`fixed:${key}`] = turns.filter((t) => t.base.has(key) && !t.arm.has(key)).length;
    out[`broken:${key}`] = turns.filter((t) => !t.base.has(key) && t.arm.has(key)).length;
  }
  return out;
}

/** 95% interval of each difference, resampling whole conversations. */
export function pairedBootstrap(turns, resamples = RESAMPLES, seed = 20261102) {
  const byConv = new Map();
  for (const turn of turns) {
    if (!byConv.has(turn.conv)) byConv.set(turn.conv, []);
    byConv.get(turn.conv).push(turn);
  }
  const groups = [...byConv.values()];
  const random = mulberry32(seed);
  const samples = Object.fromEntries(KEYS.map((key) => [key, []]));
  for (let r = 0; r < resamples; r += 1) {
    const draw = [];
    for (let g = 0; g < groups.length; g += 1)
      draw.push(...groups[Math.floor(random() * groups.length)]);
    const point = pairedStats(draw);
    for (const key of KEYS) samples[key].push(point[`diff:${key}`]);
  }
  const intervals = {};
  for (const key of KEYS) {
    const values = samples[key].sort((a, b) => a - b);
    intervals[key] = [
      values[Math.floor(0.025 * values.length)],
      values[Math.floor(0.975 * values.length)],
    ];
  }
  return intervals;
}

export function percentile(values, p) {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pts = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

function table(title, turns) {
  const point = pairedStats(turns);
  const ci = pairedBootstrap(turns);
  const rewritten = turns.filter((t) => t.rewritten).length;
  return [
    `### ${title} (${point.turns} turns, ${rewritten} rewritten = ${pct(rewritten / (point.turns || 1))})`,
    '',
    '| serious error | base | arm | diff (points) | 95% CI | fixed | broken |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...KEYS.map(
      (key) =>
        `| ${key === 'any' ? 'any origin' : 'translation (mt)'} | ${pct(point[`base:${key}`])} | ` +
        `${pct(point[`arm:${key}`])} | ${pts(point[`diff:${key}`])} | ` +
        `[${pts(ci[key][0])}, ${pts(ci[key][1])}] | ${point[`fixed:${key}`]} | ${point[`broken:${key}`]} |`,
    ),
    '',
  ].join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  const base = loadJudgements(flag('--base'));
  const arm = loadJudgements(flag('--arm'));
  if (arm.model && base.model !== arm.model)
    throw new Error(`judges differ: base ${base.model}, arm ${arm.model}`);
  const armRows = readJsonl(flag('--arm-turns'));
  const { turns, missing } = pairTurns(armRows, base.byId, arm.byId);
  const called = armRows.filter((row) => !row.failed);
  const out = [
    `# Review arm vs stored translations (judge ${base.model})`,
    '',
    `Paired turns: ${turns.length}; rewritten turns missing a judgement: ${missing}; ` +
      `reviewer failures: ${armRows.length - called.length}; ` +
      `p95 reviewer ms: ${percentile(
        called.map((r) => r.ms),
        0.95,
      )}; ` +
      `reviewer cost/turn: $${(called.reduce((s, r) => s + (r.costUsd ?? 0), 0) / (called.length || 1)).toFixed(5)}`,
    '',
    table('All turns', turns),
  ];
  for (const direction of [...new Set(turns.map((t) => t.direction))].sort())
    out.push(
      table(
        direction,
        turns.filter((t) => t.direction === direction),
      ),
    );
  console.log(out.join('\n'));
}
