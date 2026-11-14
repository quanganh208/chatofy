// Whether a decision model's repeats carry information, from a `solo` run.
//
//   node decision-variance.mjs --run results/decision-<model>-solo
//
// Over the first 30 turns, takes the spread (max − min across repeats) of
// P(covers all) and of P(wrong) for each request. Omission repeats are
// identical requests, so a spread there is sampling; fidelity repeats shuffle
// the option order, so a spread there is order sensitivity. If the largest
// spread is under 0.02, one repeat says what three would, and later sets run
// once. Prints one line, `spread <max> repeats <1|3>`, and records the
// decision in the run's meta.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonl } from './rows.mjs';

export const VARIANCE_TURNS = 30;
export const MAX_SPREAD = 0.02;

/** The probability the gate reads from one answer line. */
export function readValue(line) {
  const key = line.questionKeys.join('+');
  if (key === 'omission') return line.answers.omission.noul;
  if (key === 'fidelity') return line.answers.fidelity.probabilities.wrong ?? 0;
  throw new Error(`unexpected questions ${key}`);
}

/**
 * Largest spread across repeats. With `sameOrder`, repeats are grouped by the
 * option order they were asked in too, so the spread is sampling alone.
 */
export function maxSpread(lines, turns = VARIANCE_TURNS, { sameOrder = false } = {}) {
  const ids = [...new Set(lines.map((l) => l.id))].sort().slice(0, turns);
  const keep = new Set(ids);
  const groups = new Map();
  for (const line of lines) {
    if (line.failed || !keep.has(line.id)) continue;
    const order = sameOrder ? `|${(line.criteriaOrder ?? []).join(',')}` : '';
    const key = `${line.id}|${line.questionKeys.join('+')}${order}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(readValue(line));
  }
  let max = 0;
  for (const values of groups.values())
    max = Math.max(max, Math.max(...values) - Math.min(...values));
  return max;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const at = process.argv.indexOf('--run');
  const run = at >= 0 ? process.argv[at + 1] : null;
  if (!run) throw new Error('--run <dir> is required');
  const lines = readJsonl(join(run, 'answers.jsonl'));
  const spread = maxSpread(lines);
  const sampling = maxSpread(lines, VARIANCE_TURNS, { sameOrder: true });
  const repeats = spread < MAX_SPREAD ? 1 : 3;
  const metaFile = join(run, 'meta.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  meta.repeatDecision = {
    spread,
    samplingSpread: sampling,
    repeats,
    turns: VARIANCE_TURNS,
    maxSpread: MAX_SPREAD,
  };
  console.error(`sampling-only spread (same option order) ${sampling.toFixed(4)}`);
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  console.log(`spread ${spread.toFixed(4)} repeats ${repeats}`);
}
