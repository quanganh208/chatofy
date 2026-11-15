// Does a dropped sentence survive the prod polish?
//
//   node omission-verdict.mjs --stage survival   # results/omission-survival.{md,json}
//
// The positives are the 20 trailing drops and the 10 clause omissions
// (`data/omission/positives.jsonl`). A positive counts only when the judge
// holds a serious omission on its DRAFT in a majority of repeats: the ruler has
// to see the error before it can say whether the polish removed it.
//
// A confirmed positive survives when the polish left the draft standing (it
// declined, its guards discarded the answer, or the call failed) or when the
// judge still holds the omission on the rewritten line.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockIds } from './block-rows.mjs';
import { SERIOUS, loadJudgements, majority } from './consensus.mjs';
import { wilson } from './decision-score.mjs';
import { DATA, RESULTS, readJsonl, turnId } from './rows.mjs';

export const OMISSION_DIR = join(DATA, 'omission');
/** Error categories that name a dropped part of the source. */
export const OMISSION_CATEGORIES = new Set(['omission', 'segmentation']);
/** The A1 stop: at most this many confirmed positives may survive. */
export const SURVIVAL_STOP_AT_MOST = 2;
/** The polisher's own time limit (`POLISH_TIMEOUT_MS`). */
export const POLISH_TIMEOUT_MS = 8000;
/** Judge repeats per row. */
export const REPEATS = 3;
/** How an aborted 8 s polish reads in the replay's `failed` message. */
const TIMEOUT = /timeout|timed out|abort/i;

const hasSeriousOmission = (answer) =>
  (answer.errors ?? []).some(
    (e) => e.origin === 'mt' && SERIOUS.has(e.severity) && OMISSION_CATEGORIES.has(e.category),
  );

/** Whether the judge holds a serious omission on a majority of `answers`. */
export function heldOmission(answers = []) {
  if (!answers.length) return false;
  return answers.filter(hasSeriousOmission).length >= majority(answers.length);
}

/** A positive whose full translation would be refused by the `2 × draft + 40` guard. */
export const guardBound = (row) => row.original.length > 2 * row.translation.length + 40;

/** Why the polish left a draft standing, or `rewritten`. */
export function outcomeOf(arm) {
  if (arm.rewritten) return 'rewritten';
  if (arm.failed) return 'failed';
  if (arm.guardRejected) return 'guard-rejected';
  return 'declined';
}

/**
 * Per-positive survival. `draftAnswers` and `polishedAnswers` map a row id to
 * its judge answers; `arms` maps it to its replayed row; `blocks` is a set of
 * `conv#pos` that are block rows.
 */
export function survivalRows(
  positives,
  { draftAnswers, polishedAnswers, arms, blocks, repeats = REPEATS },
) {
  const answersFor = (answers, id, what) => {
    const list = answers.get(id) ?? [];
    // A missing answer would read as "no omission" and bias the count towards
    // the stop, so an incomplete judgement refuses to score.
    if (list.length < repeats) throw new Error(`${id}: ${list.length}/${repeats} ${what} answers`);
    return list;
  };
  return positives.map((row) => {
    const arm = arms.get(row.id);
    if (!arm) throw new Error(`${row.id}: not replayed`);
    const outcome = outcomeOf(arm);
    // A timeout leaves the draft standing in prod too; any other failure is
    // the replay's, and counting it as a survivor would inflate the result.
    if (outcome === 'failed' && !TIMEOUT.test(arm.failed)) {
      throw new Error(`${row.id}: failed with "${arm.failed}"; retry it with --resume`);
    }
    const confirmed = heldOmission(answersFor(draftAnswers, row.id, 'draft'));
    const survived =
      outcome === 'rewritten'
        ? heldOmission(answersFor(polishedAnswers, row.id, 'polished'))
        : true;
    return {
      id: row.id,
      kind: row.kind,
      block: blocks.has(turnId(row)),
      guardBound: guardBound(row),
      outcome,
      slow: (arm.ms ?? 0) > POLISH_TIMEOUT_MS,
      confirmed,
      survived,
    };
  });
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const interval = ([lo, hi]) => `${pct(lo)}–${pct(hi)}`;

/** The A1 counts: survivors among confirmed positives, split, with the gate decision. */
export function survivalSummary(rows) {
  const confirmed = rows.filter((r) => r.confirmed);
  const survivors = confirmed.filter((r) => r.survived);
  const split = (key) => {
    const groups = {};
    for (const r of confirmed) {
      const g = String(r[key]);
      groups[g] ??= { survived: 0, of: 0 };
      groups[g].of += 1;
      if (r.survived) groups[g].survived += 1;
    }
    return groups;
  };
  const outcomes = {};
  for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  return {
    positives: rows.length,
    confirmed: confirmed.length,
    survived: survivors.length,
    wilson: wilson(survivors.length, confirmed.length),
    stop: survivors.length <= SURVIVAL_STOP_AT_MOST,
    byKind: split('kind'),
    byBlock: split('block'),
    byGuardBound: split('guardBound'),
    outcomes,
    slow: rows.filter((r) => r.slow).length,
  };
}

export function survivalMarkdown(s) {
  const groups = (g) =>
    Object.entries(g)
      .map(([k, v]) => `${k} ${v.survived}/${v.of}`)
      .join(', ');
  return [
    '# Omission after the prod polish',
    '',
    `- Confirmed by the ruler: ${s.confirmed} of ${s.positives} positives.`,
    `- Survived the polish: **${s.survived} of ${s.confirmed}** (Wilson 95% ${interval(s.wilson)}); ` +
      `against all ${s.positives}: ${s.survived}/${s.positives}.`,
    `- Gate (at most ${SURVIVAL_STOP_AT_MOST} survive): **${s.stop ? 'STOP — D2 not needed' : 'continue'}**.`,
    `- By kind: ${groups(s.byKind)}. Block row: ${groups(s.byBlock)}. Guard-bound: ${groups(s.byGuardBound)}.`,
    `- Polish outcome over all ${s.positives}: ${Object.entries(s.outcomes)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}; slower than ${POLISH_TIMEOUT_MS / 1000} s: ${s.slow}.`,
    '',
  ].join('\n');
}

function survivalStage() {
  const positives = readJsonl(join(OMISSION_DIR, 'positives.jsonl'));
  const arms = new Map(readJsonl(join(OMISSION_DIR, 'a1-polished.jsonl')).map((r) => [r.id, r]));
  const draftAnswers = new Map([
    ...loadJudgements(join(RESULTS, 'cal-broken-claude-opus-5-5')).byId,
    ...loadJudgements(join(RESULTS, 'omission-ruler-trailing')).byId,
  ]);
  const rewritten = [...arms.values()].some((r) => r.rewritten);
  const polishedAnswers = rewritten
    ? loadJudgements(join(RESULTS, 'omission-a1-rewritten')).byId
    : new Map();
  const blocks = new Set(blockIds(readJsonl(join(DATA, 'turns.scribed.jsonl'))));
  const rows = survivalRows(positives, { draftAnswers, polishedAnswers, arms, blocks });
  const summary = survivalSummary(rows);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, 'omission-survival.json'),
    JSON.stringify({ summary, rows }, null, 2) + '\n',
  );
  writeFileSync(join(RESULTS, 'omission-survival.md'), survivalMarkdown(summary));
  process.stdout.write(survivalMarkdown(summary));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const stage = process.argv[process.argv.indexOf('--stage') + 1];
  if (stage === 'survival') survivalStage();
  else throw new Error('--stage must be survival');
}
