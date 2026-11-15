// Would a polish length guard bounded by the source keep restores and still
// stop runaways?
//
//   node guard-bound.mjs --stage restores            # criterion 1, offline
//   node guard-bound.mjs --stage runaways            # criterion 2, offline
//   node guard-bound.mjs --stage regression-input    # data/guard/regression-input.jsonl
//   node guard-bound.mjs --stage regression-split    # data/guard/regression-diff.jsonl
//   node guard-bound.mjs --stage regression-verdict  # criterion 3
//
// The prod guard drops an answer longer than `2 × draft + 40` characters. A
// draft that lost a sentence is short, so the restore reads as a runaway. The
// rule under test bounds en and vi targets by the longer of draft and source;
// a zh translation is far shorter than its source, so zh keeps the draft bound.
//
// Every stage writes into `results/guard-bound.json` (merged by stage) and
// `results/guard-bound.md`. The markdown holds counts and lengths, never text.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { consensus, loadJudgements } from './consensus.mjs';
import { wilson } from './decision-score.mjs';
import { languagesOf } from './review-arms.mjs';
import { DATA, RESULTS, readJsonl, toJsonl, turnId } from './rows.mjs';

export const GUARD_DIR = join(DATA, 'guard');
/** Targets whose translation runs about as long as its source. */
export const SOURCE_BOUND_TARGETS = new Set(['en', 'vi']);
/** Context turns the polish prompt keeps (`translation-polish-prompt.ts`). */
export const CONTEXT_WINDOW = 3;
/** Rows per runaway shape. */
export const PER_SHAPE = 10;
/** Bars, fixed before the runs. */
export const BARS = {
  restoresAccepted: 9, // of 10
  runawaysRejected: 19, // of 20, per set
  regressionMaxDiff: 30,
  regressionConclusiveFrom: 3, // a diff set of 0–2 rows is inconclusive
};

/** The answer as the guard measures it: transcript and draft tags removed, trimmed. */
export const editedOf = (raw) =>
  String(raw ?? '')
    .replace(/<\/?(transcript|draft)>/gi, '')
    .trim();

/** Today's guard. */
export const oldLimit = ({ draft }) => 2 * draft.length + 40;

/** The rule under test. */
export const newLimit = (req) =>
  SOURCE_BOUND_TARGETS.has(req.targetLanguage)
    ? 2 * Math.max(req.draft.length, req.source.length) + 40
    : oldLimit(req);

export const rejects = (raw, req, limit) => editedOf(raw).length > limit(req);

/** The polish request for a row whose `translation` is the draft. */
export function requestOf(row) {
  const [sourceLanguage, targetLanguage] = languagesOf(row);
  return { source: row.source, draft: row.translation, sourceLanguage, targetLanguage };
}

const COMMENT = {
  en: (source) =>
    `Note: I corrected the draft so that it follows the source closely. The source says: "${source}"`,
  vi: (source) => `Ghi chú: tôi đã sửa bản nháp để bám sát câu gốc. Câu gốc là: "${source}"`,
};

/**
 * Synthetic runaways from `rows`, sorted by id. `full(row)` is the faithful
 * answer the runaway wraps.
 * - context: the polisher's last 3 context turns translated too, then the answer;
 * - commentary: the answer followed by a note quoting the source. It is over
 *   `2 × source + 40` by construction, so only the context shape tests the rule.
 */
export function runaways(rows, full, set) {
  const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const withContext = sorted.filter((r) => (r.context ?? []).length >= 2).slice(0, PER_SHAPE);
  if (withContext.length < PER_SHAPE)
    throw new Error(`${set}: ${withContext.length} rows with context`);
  const used = new Set(withContext.map((r) => r.id));
  const rest = sorted.filter((r) => !used.has(r.id)).slice(0, PER_SHAPE);
  if (rest.length < PER_SHAPE) throw new Error(`${set}: ${rest.length} rows for commentary`);
  const build = (row, shape) => {
    const req = requestOf(row);
    const answer =
      shape === 'context'
        ? [...row.context.slice(-CONTEXT_WINDOW).map((t) => t.translation), full(row)].join(' ')
        : `${full(row)}\n\n${COMMENT[req.targetLanguage](row.source)}`;
    return {
      id: row.id,
      set,
      shape,
      direction: row.direction,
      draft: req.draft.length,
      source: req.source.length,
      answerLength: editedOf(answer).length,
      oldLimit: oldLimit(req),
      newLimit: newLimit(req),
    };
  };
  return [
    ...withContext.map((r) => build(r, 'context')),
    ...rest.map((r) => build(r, 'commentary')),
  ];
}

const ratio = (a, b) => Number((a / b).toFixed(3));

/** Criterion 1 over the A1 replay: the guard-rejected raws the new rule would accept. */
export function restoresVerdict(polished) {
  const rejected = polished.filter((r) => r.guardRejected);
  const withRaw = polished.filter((r) => editedOf(r.raw));
  const newAccepted = rejected.filter((r) => !rejects(r.raw, requestOf(r), newLimit)).length;
  const oldAccepted = rejected.filter((r) => !rejects(r.raw, requestOf(r), oldLimit)).length;
  return {
    total: rejected.length,
    newAccepted,
    oldAccepted,
    wilson: wilson(newAccepted, rejected.length),
    rawAnswers: withRaw.length,
    maxEditedOverNewLimit: Math.max(
      ...withRaw.map((r) => ratio(editedOf(r.raw).length, newLimit(requestOf(r)))),
    ),
    pass: rejected.length === 10 && newAccepted >= BARS.restoresAccepted,
  };
}

/** Criterion 2: per set and shape, rejected by each rule. */
export function runawaysVerdict(rows) {
  const out = { pass: true };
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = rows.filter((r) => r.set === set);
    const newRejected = of.filter((r) => r.answerLength > r.newLimit);
    const byShape = {};
    for (const shape of ['context', 'commentary']) {
      const s = of.filter((r) => r.shape === shape);
      const rejected = s.filter((r) => r.answerLength > r.newLimit);
      byShape[shape] = {
        total: s.length,
        newRejected: rejected.length,
        oldRejected: s.filter((r) => r.answerLength > r.oldLimit).length,
        minAnswerOverNewLimit: Math.min(...s.map((r) => ratio(r.answerLength, r.newLimit))),
      };
    }
    out[set] = {
      total: of.length,
      newRejected: newRejected.length,
      oldRejected: of.filter((r) => r.answerLength > r.oldLimit).length,
      wilson: wilson(newRejected.length, of.length),
      byShape,
      acceptedIds: of.filter((r) => r.answerLength <= r.newLimit).map((r) => r.id),
    };
    out.pass &&= of.length === 20 && newRejected.length >= BARS.runawaysRejected;
  }
  return out;
}

/** The 162 judged turns, as turn rows (labels carry no translation field). */
export function regressionInput(labels, turns) {
  const ids = new Set(labels.map(turnId));
  return turns.filter((t) => ids.has(turnId(t)) && t.translation);
}

/**
 * Rows the new rule accepts and today's rejects, after the polisher's other
 * checks (`finalize` returns the rendered edit or `null`, as `accept()` does).
 * The draft comes from the input file: a rewritten replay row has the polish
 * in `translation`.
 */
export function regressionSplit(polished, input, finalize) {
  const draftOf = new Map(input.map((r) => [turnId(r), r]));
  const counts = { rows: polished.length, failed: 0, rewritten: 0, declined: 0, oldRejected: 0 };
  const diff = [];
  let tightened = 0;
  for (const row of polished) {
    const base = draftOf.get(turnId(row));
    if (!base) throw new Error(`${turnId(row)}: not in the input`);
    if (row.failed) counts.failed += 1;
    else if (row.rewritten) counts.rewritten += 1;
    const req = requestOf(base);
    if (newLimit(req) < oldLimit(req)) tightened += 1;
    if (row.rewritten || row.failed || !editedOf(row.raw)) continue;
    if (!rejects(row.raw, req, oldLimit)) {
      counts.declined += 1;
      continue;
    }
    counts.oldRejected += 1;
    if (rejects(row.raw, req, newLimit)) continue;
    const text = finalize({ ...req }, editedOf(row.raw));
    if (text) diff.push({ ...base, id: turnId(base), translation: text });
  }
  if (tightened) throw new Error(`${tightened} rows where the new limit is below the old`);
  const byDirection = {};
  for (const r of diff) byDirection[r.direction] = (byDirection[r.direction] ?? 0) + 1;
  return { counts: { ...counts, diff: diff.length, byDirection }, diff };
}

const seriousKeys = (answers) => [...consensus(answers).keys].filter((k) => k.includes(':'));

/**
 * Criterion 3: a diff row introduces a serious error when its majority holds a
 * serious `origin:category` the draft's majority does not.
 */
export function regressionVerdict(diff, { draftAnswers, diffAnswers, repeats = 3 }) {
  const rows = diff.map((row) => {
    const id = row.id ?? turnId(row);
    const d = draftAnswers.get(id) ?? [];
    const p = diffAnswers.get(id) ?? [];
    if (d.length < repeats || p.length < repeats) {
      throw new Error(`${id}: ${d.length} draft, ${p.length} diff answers of ${repeats}`);
    }
    const before = new Set(seriousKeys(d));
    const after = seriousKeys(p);
    return { id, introduced: after.filter((k) => !before.has(k)), serious: after.length > 0 };
  });
  const n = rows.length;
  const introduced = rows.filter((r) => r.introduced.length).length;
  const status =
    introduced > 0 || n > BARS.regressionMaxDiff
      ? 'stop'
      : n < BARS.regressionConclusiveFrom
        ? 'inconclusive'
        : 'pass';
  return {
    n,
    introduced,
    seriousAtAll: rows.filter((r) => r.serious).length,
    wilson: n ? wilson(introduced, n) : null,
    status,
    introducedKeys: rows.flatMap((r) => r.introduced),
  };
}

export function markdown(report) {
  const lines = ['# Polish length guard bounded by the source', ''];
  const pct = ([lo, hi]) => `${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%`;
  if (report.restores) {
    const r = report.restores;
    lines.push(
      `- Restores (criterion 1): new rule accepts **${r.newAccepted}/${r.total}** (Wilson ${pct(r.wilson)}), ` +
        `old ${r.oldAccepted}/${r.total}; max answer/new limit over ${r.rawAnswers} raws ${r.maxEditedOverNewLimit}. ` +
        `**${r.pass ? 'PASS' : 'STOP'}**.`,
    );
  }
  if (report.runaways) {
    for (const [set, s] of Object.entries(report.runaways)) {
      if (set === 'pass') continue;
      const shapes = Object.entries(s.byShape)
        .map(
          ([k, v]) =>
            `${k} new ${v.newRejected}/${v.total}, old ${v.oldRejected}/${v.total}, min answer/new limit ${v.minAnswerOverNewLimit}`,
        )
        .join('; ');
      lines.push(
        `- Runaways ${set} (criterion 2): new rule rejects **${s.newRejected}/${s.total}** (Wilson ${pct(s.wilson)}), ` +
          `old ${s.oldRejected}/${s.total}. ${shapes}. Accepted: ${s.acceptedIds.length}.`,
      );
    }
    lines.push(`- Runaways: **${report.runaways.pass ? 'PASS' : 'STOP'}**.`);
  }
  if (report.regressionSplit) {
    const c = report.regressionSplit;
    lines.push(
      `- Replay: ${c.rows} rows, ${c.failed} failed, ${c.rewritten} rewritten, ${c.declined} declined, ` +
        `${c.oldRejected} rejected by the old rule, diff ${c.diff} (${JSON.stringify(c.byDirection)}).`,
    );
  }
  if (report.regression) {
    const g = report.regression;
    lines.push(
      `- Regression (criterion 3): ${g.introduced}/${g.n} introduce a serious error` +
        (g.wilson ? ` (Wilson ${pct(g.wilson)})` : '') +
        `, ${g.seriousAtAll} serious at all. **${g.status.toUpperCase()}**.`,
    );
  }
  return lines.join('\n') + '\n';
}

function save(stage, value) {
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, 'guard-bound.json');
  const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  report[stage] = value;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(RESULTS, 'guard-bound.md'), markdown(report));
  process.stdout.write(markdown(report));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const stage = process.argv[process.argv.indexOf('--stage') + 1];
  const input = join(GUARD_DIR, 'regression-input.jsonl');
  const polishedFile = join(GUARD_DIR, 'regression-polished.jsonl');
  const diffFile = join(GUARD_DIR, 'regression-diff.jsonl');
  if (stage === 'restores') {
    save('restores', restoresVerdict(readJsonl(join(DATA, 'omission', 'a1-polished.jsonl'))));
  } else if (stage === 'runaways') {
    const clean = readJsonl(join(DATA, 'calibration-clean.jsonl'));
    const positives = readJsonl(join(DATA, 'omission', 'positives.jsonl'));
    const rows = [
      ...runaways(clean, (r) => r.translation, 'clean'),
      ...runaways(positives, (r) => r.original, 'shortDraft'),
    ];
    save('runaways', runawaysVerdict(rows));
  } else if (stage === 'regression-input') {
    const rows = regressionInput(
      readJsonl(join(DATA, 'decision', 'labels.jsonl')),
      readJsonl(join(DATA, 'turns.scribed.jsonl')),
    );
    mkdirSync(GUARD_DIR, { recursive: true });
    writeFileSync(input, toJsonl(rows));
    const byDirection = {};
    for (const r of rows) byDirection[r.direction] = (byDirection[r.direction] ?? 0) + 1;
    save('regressionInput', { rows: rows.length, byDirection });
  } else if (stage === 'regression-split') {
    const { leaksForeignScript, toTargetScript } =
      await import('../../packages/ai-providers/dist/index.js');
    // The rest of `accept()`: a foreign-script leak, the target script, an
    // answer that equals the draft.
    const finalize = (req, edited) => {
      if (leaksForeignScript(req.sourceLanguage, req.targetLanguage, req.source, edited))
        return null;
      const rendered = toTargetScript(req.targetLanguage, edited);
      return rendered === req.draft.trim() ? null : rendered;
    };
    const polished = readJsonl(polishedFile);
    const inputRows = readJsonl(input);
    if (polished.length !== inputRows.length || polished.some((r) => r.failed)) {
      throw new Error(
        `replay incomplete: ${polished.length}/${inputRows.length} rows, failed ones kept`,
      );
    }
    const { counts, diff } = regressionSplit(polished, inputRows, finalize);
    writeFileSync(diffFile, toJsonl(diff));
    save('regressionSplit', counts);
  } else if (stage === 'regression-verdict') {
    const diff = readJsonl(diffFile);
    const draftAnswers = loadJudgements(join(RESULTS, 'full-claude-opus-5-5')).byId;
    const diffAnswers = diff.length
      ? loadJudgements(join(RESULTS, 'guard-regression-diff')).byId
      : new Map();
    save('regression', regressionVerdict(diff, { draftAnswers, diffAnswers }));
  } else {
    throw new Error('--stage must be restores, runaways or regression-{input,split,verdict}');
  }
}
