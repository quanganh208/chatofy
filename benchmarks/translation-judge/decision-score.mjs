// Scores the decision-model runs against the bars fixed before they ran.
//
//   node decision-score.mjs   # reads results/decision-<model>-<set>, writes results/decision-verdict.md
//
// D1, polish gate. A turn is polished when its gate score — the mean over
// repeats of P(wrong) on the fidelity question — reaches a threshold chosen
// leave-one-conversation-out: on the other conversations, the largest
// threshold that keeps at least 95% of their serious-mt drafts. With under 20
// training positives that is the lowest of them, so the globally lowest
// positive is always missed: one miss is the method's floor. The verdict is
// the contract's pooled bars. vi→en alone is printed beside it as a stricter
// reading (18 of the 20 positives are vi→en and `direction` is in the state),
// with the bars unscaled, and both again without the 7 turns the judge's
// repeats split on.
//
// D2, omission check. A translation is flagged when the mean P(covers every
// sentence) is under 0.5, a threshold fixed in advance. The trailing drops are
// also read paired: their intact drafts are judged turns, so the drop in
// P(covers all) from intact to dropped is reported per row.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callKey } from './decision-gate.mjs';
import { DATA, RESULTS, readJsonl, turnId } from './rows.mjs';

export const RECALL_TARGET = 0.95;
export const OMISSION_FLAG_BELOW = 0.5;
const MODELS = ['gemini', 'jev'];

/** Wilson 95% interval for k of n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Answer lines of one run, last non-failed answer per call. */
export function loadAnswers(dir) {
  const file = join(dir, 'answers.jsonl');
  if (!existsSync(file)) return null;
  const byKey = new Map();
  for (const line of readJsonl(file)) if (!line.failed) byKey.set(callKey(line), line);
  return [...byKey.values()];
}

const pWrong = (line) => line.answers.fidelity.probabilities.wrong ?? 0;
const pCovers = (line) => line.answers.omission.noul;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** id -> { mean, perRepeat: Map(repeat -> value) } for one arm and reader. */
export function scoresBy(lines, arm, read, questionKeys = 'fidelity+omission') {
  const out = new Map();
  for (const line of lines) {
    if (line.arm !== arm || line.questionKeys.join('+') !== questionKeys) continue;
    if (!out.has(line.id)) out.set(line.id, new Map());
    out.get(line.id).set(line.repeat, read(line));
  }
  return new Map(
    [...out].map(([id, reps]) => [id, { mean: mean([...reps.values()]), perRepeat: reps }]),
  );
}

/** The largest threshold whose recall over `rows` is at least `target`. */
export function thresholdFor(rows, score, target = RECALL_TARGET) {
  const positives = rows
    .filter((r) => r.draftSeriousMt)
    .map(score)
    .sort((a, b) => b - a);
  if (!positives.length) return -Infinity;
  return positives[Math.ceil(target * positives.length) - 1];
}

/** Each row's threshold, chosen without its own conversation. */
export function locoThresholds(rows, score, target = RECALL_TARGET) {
  const byConv = new Map();
  for (const conv of new Set(rows.map((r) => r.conv)))
    byConv.set(
      conv,
      thresholdFor(
        rows.filter((r) => r.conv !== conv),
        score,
        target,
      ),
    );
  return rows.map((r) => byConv.get(r.conv));
}

/** Area under the ROC curve: P(score of a positive > score of a negative). */
export function auc(rows, score) {
  const pos = rows.filter((r) => r.draftSeriousMt).map(score);
  const neg = rows.filter((r) => !r.draftSeriousMt).map(score);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% interval of a statistic, resampling conversations. */
export function convBootstrap(rows, statistic, draws = 2000, seed = 7) {
  const convs = [...new Set(rows.map((r) => r.conv))];
  const byConv = new Map(convs.map((c) => [c, rows.filter((r) => r.conv === c)]));
  const next = seeded(seed);
  const values = [];
  for (let i = 0; i < draws; i += 1) {
    const sample = Array.from({ length: convs.length }, () =>
      byConv.get(convs[Math.floor(next() * convs.length)]),
    ).flat();
    const v = statistic(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  return [values[Math.floor(0.025 * values.length)], values[Math.floor(0.975 * values.length)]];
}

/** The polish-gate table for one subset of labelled rows carrying `score`. */
export function gateStats(rows, { repeats }) {
  const score = (r) => r.score;
  const thresholds = locoThresholds(rows, score);
  const polish = rows.map((r, i) => r.score >= thresholds[i]);
  const positives = rows.filter((r) => r.draftSeriousMt).length;
  const misses = rows.filter((r, i) => r.draftSeriousMt && !polish[i]).length;
  const serious = rows.filter((r, i) =>
    polish[i] ? r.polishedSeriousMt : r.draftSeriousMt,
  ).length;
  const otherOrigin = rows
    .map((r, i) => [r, i])
    .filter(([r]) => r.draftSeriousAny && !r.draftSeriousMt);
  let flips = null;
  if (repeats > 1) {
    flips =
      rows.filter((r, i) => {
        const verdicts = new Set([...r.perRepeat.values()].map((v) => v >= thresholds[i]));
        return verdicts.size > 1;
      }).length / rows.length;
  }
  return {
    n: rows.length,
    positives,
    misses,
    recallCi: wilson(positives - misses, positives),
    skip: polish.filter((p) => !p).length / rows.length,
    seriousAfter: serious / rows.length,
    firesOnOtherOrigin: `${otherOrigin.filter(([, i]) => polish[i]).length}/${otherOrigin.length}`,
    flips,
    auc: auc(rows, score),
  };
}

/** Skip rate the score reaches at the recall a fixed rule reaches, on the same rows. */
export function skipAtRecall(rows, recall) {
  const positives = rows
    .filter((r) => r.draftSeriousMt)
    .map((r) => r.score)
    .sort((a, b) => b - a);
  const t = positives[Math.max(0, Math.ceil(recall * positives.length) - 1)];
  return rows.filter((r) => r.score < t).length / rows.length;
}

/** The direction rule: polish vi→en, skip the rest. */
export function directionRule(rows) {
  const polish = (r) => r.direction === 'vi_to_en';
  const positives = rows.filter((r) => r.draftSeriousMt);
  const caught = positives.filter(polish).length;
  return {
    misses: positives.length - caught,
    recall: positives.length ? caught / positives.length : NaN,
    skip: rows.filter((r) => !polish(r)).length / rows.length,
  };
}

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const num = (x, d = 3) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(d));
const mark = (ok) => (ok ? 'PASS' : 'FAIL');

function readRun(model, set) {
  return loadAnswers(join(RESULTS, `decision-${model}-${set}`));
}

function d1Section(model, labels, judged, repeats, lines) {
  for (const arm of ['ctx', 'noctx']) {
    const scores = scoresBy(judged, arm, pWrong);
    const rows = labels
      .filter((r) => scores.has(r.id))
      .map((r) => ({ ...r, score: scores.get(r.id).mean, perRepeat: scores.get(r.id).perRepeat }));
    if (rows.length !== labels.length)
      lines.push(`> ${model} ${arm}: ${rows.length} of ${labels.length} turns answered`);
    for (const [name, subset] of [
      ['vi→en (stricter reading)', rows.filter((r) => r.direction === 'vi_to_en')],
      ['vi→en, stable only', rows.filter((r) => r.direction === 'vi_to_en' && !r.unstable)],
      ['pooled', rows],
      ['pooled, stable only', rows.filter((r) => !r.unstable)],
    ]) {
      const s = gateStats(subset, { repeats });
      const rule = directionRule(subset);
      const edge = skipAtRecall(subset, rule.recall) - rule.skip;
      const verdictRow = name === 'pooled';
      const bars = [
        s.misses <= 1,
        s.seriousAfter <= 0.025,
        s.skip >= 0.5,
        name.startsWith('vi→en') || edge >= 0.15,
        s.flips == null || s.flips <= 0.05,
      ];
      lines.push(
        `| D1 | ${model} | ${arm} | ${name} | ${s.n} | ${s.misses}/${s.positives} (recall CI ${num(s.recallCi[0], 2)}–${num(s.recallCi[1], 2)}) | ${pct(s.skip)} | ${pct(s.seriousAfter)} | ${pct(edge)} | ${s.flips == null ? 'none (deterministic: solo repeat spread 0)' : pct(s.flips)} | ${s.firesOnOtherOrigin} | ${num(s.auc)} | ${verdictRow ? mark(bars.every(Boolean)) : 'report'} |`,
      );
    }
  }
}

function d2Section(model, calibration, trailing, judged, lines) {
  const byId = (rows) => {
    const m = new Map();
    for (const l of rows) {
      if (!m.has(l.id)) m.set(l.id, []);
      m.get(l.id).push(l);
    }
    return m;
  };
  const meanFlag = (group) => mean(group.map(pCovers)) < OMISSION_FLAG_BELOW;
  const rate = (rows, filter) => {
    const groups = [...byId(rows.filter(filter)).values()];
    return [groups.filter(meanFlag).length, groups.length];
  };
  const [omit, omitN] = rate(calibration ?? [], (l) => l.kind === 'omission');
  const [clean, cleanN] = rate(calibration ?? [], (l) => l.kind === 'clean');
  const [trail, trailN] = rate(trailing ?? [], () => true);
  lines.push(
    `| D2 | ${model} | clause omission (cal-broken) | ${omit}/${omitN} | ≥ 9/10 | ${mark(omit >= 9)} |`,
  );
  lines.push(
    `| D2 | ${model} | trailing sentence dropped | ${trail}/${trailN} | ≥ 90% | ${mark(trailN && trail / trailN >= 0.9)} |`,
  );
  lines.push(
    `| D2 | ${model} | cal-clean flagged | ${clean}/${cleanN} | ≤ 4/40 | ${mark(clean <= 4)} |`,
  );
  for (const kind of ['negation', 'name', 'number']) {
    const [k, n] = rate(calibration ?? [], (l) => l.kind === kind);
    lines.push(
      `| D2 | ${model} | ${kind} (not this question's job) | ${k}/${n} | report | report |`,
    );
  }
  // Paired: the same turn intact (judged, ctx) vs with its last sentence dropped.
  const intact = scoresBy(judged ?? [], 'ctx', pCovers);
  const drops = scoresBy(trailing ?? [], 'ctx', pCovers);
  const deltas = [...drops]
    .map(([id, d]) => intact.get(id.replace(/~trailing$/, ''))?.mean - d.mean)
    .filter(Number.isFinite);
  if (deltas.length)
    lines.push(
      `| D2 | ${model} | paired drop in P(covers all), intact − dropped | mean ${num(mean(deltas))}, lowered on ${deltas.filter((d) => d > 0).length}/${deltas.length} | report | report |`,
    );
}

function soloSection(model, solo, judged, lines) {
  if (!solo || !judged) return;
  for (const [kind, read] of [
    ['fidelity', pWrong],
    ['omission', pCovers],
  ]) {
    const alone = scoresBy(solo, 'ctx', read, kind);
    const together = scoresBy(judged, 'ctx', read);
    const diffs = [];
    for (const [id, a] of alone)
      for (const repeat of [1, 2]) {
        const x = a.perRepeat.get(repeat);
        const y = together.get(id)?.perRepeat.get(repeat);
        if (Number.isFinite(x) && Number.isFinite(y)) diffs.push(Math.abs(x - y));
      }
    if (diffs.length)
      lines.push(
        `| solo vs joint | ${model} | ${kind} | mean |Δ| ${num(mean(diffs))} over ${diffs.length} answers (repeats 1–2) |`,
      );
  }
}

export function buildReport() {
  const labels = readJsonl(join(DATA, 'decision', 'labels.jsonl')).map((r) => ({
    ...r,
    id: turnId(r),
  }));
  const lines = [
    '# Decision-model verdict',
    '',
    'Latency is from the dev desk, not the prod host.',
    '',
  ];
  lines.push(
    '| D1 | model | arm | subset | n | missed positives | skip | serious after gating | skip edge over direction rule | flips | fires on non-mt serious | AUC | bars |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const runs = {};
  for (const model of MODELS) {
    const judged = readRun(model, 'judged');
    runs[model] = {
      judged,
      calibration: readRun(model, 'calibration'),
      trailing: readRun(model, 'trailing'),
      solo: readRun(model, 'solo'),
    };
    if (!judged) {
      lines.push(`| D1 | ${model} | — | not run | | | | | | | | | |`);
      continue;
    }
    const repeats = Math.max(...judged.map((l) => l.repeat));
    d1Section(model, labels, judged, repeats, lines);
  }
  const rule = directionRule(labels);
  lines.push(
    '',
    `Direction rule (polish vi→en only), pooled: ${rule.misses} missed, skip ${pct(rule.skip)}. Always polish: serious after = ${pct(labels.filter((r) => r.polishedSeriousMt).length / labels.length)} pooled, ${pct(labels.filter((r) => r.direction === 'vi_to_en' && r.polishedSeriousMt).length / labels.filter((r) => r.direction === 'vi_to_en').length)} on vi→en. The skip edge uses an in-sample threshold at the rule's recall, as planned, so it is optimistic.`,
    '',
  );
  if (runs.gemini.judged && runs.jev.judged) {
    const rowsFor = (model) => {
      const s = scoresBy(runs[model].judged, 'ctx', pWrong);
      return labels.filter((r) => s.has(r.id)).map((r) => ({ ...r, [model]: s.get(r.id).mean }));
    };
    const g = new Map(rowsFor('gemini').map((r) => [r.id, r.gemini]));
    const both = rowsFor('jev')
      .filter((r) => g.has(r.id))
      .map((r) => ({ ...r, gemini: g.get(r.id) }));
    const diff = (rows) => auc(rows, (r) => r.gemini) - auc(rows, (r) => r.jev);
    const [lo, hi] = convBootstrap(both, diff);
    lines.push(
      `AUC gemini − jev (ctx, pooled): ${num(diff(both))}, 95% conversation-bootstrap ${num(lo)} to ${num(hi)}.`,
      '',
    );
  }
  lines.push('| D2 | model | case | caught | bar | verdict |', '|---|---|---|---|---|---|');
  for (const model of MODELS)
    d2Section(model, runs[model].calibration, runs[model].trailing, runs[model].judged, lines);
  lines.push('', '| check | model | question | result |', '|---|---|---|---|');
  for (const model of MODELS) soloSection(model, runs[model].solo, runs[model].judged, lines);
  lines.push('', '| latency | model | p50 ms | p95 ms | answers |', '|---|---|---|---|---|');
  for (const model of MODELS) {
    const ms = Object.values(runs[model])
      .flatMap((r) => r ?? [])
      .map((l) => l.ms)
      .filter(Number.isFinite);
    if (ms.length)
      lines.push(
        `| latency | ${model} | ${percentile(ms, 0.5)} | ${percentile(ms, 0.95)} | ${ms.length} |`,
      );
  }
  return lines.join('\n') + '\n';
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const report = buildReport();
  writeFileSync(join(RESULTS, 'decision-verdict.md'), report);
  process.stdout.write(report);
}
