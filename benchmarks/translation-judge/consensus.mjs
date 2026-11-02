// What the repeats of one turn agree on.
//
// The judge samples, so one answer is not a finding. An error counts for a turn
// when a majority of its repeats (2 of 3) report it, matched not by span text,
// which drifts between repeats, but by what it says is wrong: its origin, and
// its origin plus category. Only major and critical errors make a turn "wrong";
// minor ones are counted separately because a reader still gets the meaning.
import { readJsonl } from './rows.mjs';

export const SERIOUS = new Set(['major', 'critical']);

/** The keys one answer asserts: `any`, each origin, and each origin:category. */
export function answerKeys(answer, { serious = true } = {}) {
  const keys = new Set();
  for (const error of answer.errors ?? []) {
    if (serious && !SERIOUS.has(error.severity)) continue;
    keys.add('any');
    keys.add(error.origin);
    keys.add(`${error.origin}:${error.category}`);
  }
  return keys;
}

/** A turn's label for agreement: the sorted origins of its serious errors. */
export function answerLabel(answer) {
  const origins = [...answerKeys(answer)].filter((key) => key !== 'any' && !key.includes(':'));
  return origins.length ? origins.sort().join('+') : 'none';
}

export function majority(n) {
  return Math.floor(n / 2) + 1;
}

/**
 * One turn's consensus over its answers.
 *
 * `keys` holds what a majority asserted; `agreed` says whether a majority gave
 * the very same label, which is the agreement the calibration gate reads.
 */
export function consensus(answers, options) {
  const need = majority(answers.length);
  const counts = new Map();
  const labels = new Map();
  for (const answer of answers) {
    for (const key of answerKeys(answer, options)) counts.set(key, (counts.get(key) ?? 0) + 1);
    const label = answerLabel(answer);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const keys = new Set([...counts].filter(([, n]) => n >= need).map(([key]) => key));
  const agreed = Math.max(0, ...labels.values()) >= need;
  return { keys, agreed, repeats: answers.length };
}

/**
 * Judgements grouped by row id, failed calls left out.
 *
 * Refuses a file that mixes models: a table that blends two judges is a
 * number nobody chose (the rule `error-analysis` set for its arms).
 */
export function loadJudgements(dir) {
  const lines = readJsonl(`${dir}/judgements.jsonl`).filter((line) => !line.failed);
  const models = new Set(lines.map((line) => line.model));
  if (models.size > 1) throw new Error(`${dir} mixes models: ${[...models].join(', ')}`);
  const byId = new Map();
  for (const line of lines) {
    if (!byId.has(line.id)) byId.set(line.id, []);
    byId.get(line.id).push(line);
  }
  return { model: [...models][0] ?? null, byId };
}
