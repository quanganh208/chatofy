// Where the errors come from: the table a calibrated judge run produces.
//
//   node score.mjs --run results/<run> --turns data/turns.scribed.jsonl
//
// Per turn, the consensus of its repeats (`consensus.mjs`). Two kinds of share:
//   - of turns: how many turns carry a serious error of each origin;
//   - of errors: how the serious (turn, origin) findings split between origins,
//     which is what the verdict rule reads.
// Each with a 95% bootstrap interval that resamples CONVERSATIONS, not turns:
// turns of one conversation share a speaker, a topic and a recording, so
// treating them as independent would make the interval too narrow.
//
// Writes to stdout only.
import { fileURLToPath } from 'node:url';

import { consensus, loadJudgements } from './consensus.mjs';
import { readJsonl, turnId } from './rows.mjs';

export const ORIGINS = ['asr', 'mt', 'segmentation', 'unclear'];
const RESAMPLES = 10_000;

/** Seeded PRNG so the interval is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One record per judged turn: its conversation, direction, length and consensus keys. */
export function judgedTurns(turns, byId) {
  const out = [];
  for (const row of turns) {
    const answers = byId.get(turnId(row));
    if (!answers || answers.length < 2) continue;
    const serious = consensus(answers);
    out.push({
      conv: row.conv,
      direction: row.direction,
      short: row.words <= 4,
      scribeMissing: Boolean(row.scribe_missing),
      keys: serious.keys,
      minorKeys: consensus(answers, { serious: false }).keys,
      agreed: serious.agreed,
    });
  }
  return out;
}

/** The statistics the verdict reads, over any set of judged turns. */
export function stats(turns) {
  const n = turns.length;
  const count = (key) => turns.filter((turn) => turn.keys.has(key)).length;
  const findings = ORIGINS.reduce((sum, origin) => sum + count(origin), 0);
  const result = { turns: n, anySerious: n ? count('any') / n : null, findings };
  for (const origin of ORIGINS) {
    result[`turns:${origin}`] = n ? count(origin) / n : null;
    result[`errors:${origin}`] = findings ? count(origin) / findings : null;
  }
  const mt = count('mt');
  result['mt:terminology'] = mt ? count('mt:terminology') / mt : null;
  result.anyMinorOrWorse = n ? turns.filter((turn) => turn.minorKeys.has('any')).length / n : null;
  return result;
}

/** 95% percentile interval of every statistic, resampling conversations. */
export function bootstrap(turns, resamples = RESAMPLES, seed = 20261102) {
  const byConv = new Map();
  for (const turn of turns) {
    if (!byConv.has(turn.conv)) byConv.set(turn.conv, []);
    byConv.get(turn.conv).push(turn);
  }
  const groups = [...byConv.values()];
  const random = mulberry32(seed);
  const samples = new Map();
  for (let r = 0; r < resamples; r += 1) {
    const draw = [];
    for (let g = 0; g < groups.length; g += 1)
      draw.push(...groups[Math.floor(random() * groups.length)]);
    for (const [key, value] of Object.entries(stats(draw))) {
      if (typeof value !== 'number' || key === 'turns' || key === 'findings') continue;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(value);
    }
  }
  const intervals = {};
  for (const [key, values] of samples) {
    values.sort((a, b) => a - b);
    intervals[key] = [
      values[Math.floor(0.025 * values.length)],
      values[Math.floor(0.975 * values.length)],
    ];
  }
  return intervals;
}

/** The plan's decision rule, read off the point estimates and intervals. */
export function verdict(point, ci) {
  if (!point.findings) return 'no serious errors found: no lever is supported';
  if (point['errors:asr'] >= 0.5)
    return 'STT first: hearing causes at least half of the serious errors';
  if (point['errors:mt'] >= 0.4 && ci['errors:mt']?.[0] > 0.2) {
    const terms =
      point['mt:terminology'] >= 0.3 ? '; terminology is ≥ 30% of them, so domain packs too' : '';
    return `polish-lane review loop: translation causes ≥ 40% of serious errors${terms}`;
  }
  if (point['errors:segmentation'] >= 0.3)
    return 'the committer: segmentation causes ≥ 30% of serious errors';
  return 'no single lever: the table is the record';
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const interval = (ci) => (ci ? `[${pct(ci[0])}, ${pct(ci[1])}]` : '');

function table(title, turns) {
  const point = stats(turns);
  const ci = bootstrap(turns);
  const rows = [
    `### ${title} (${point.turns} turns, ${point.findings} serious findings)`,
    '',
    '| statistic | value | 95% CI |',
    '| --- | --- | --- |',
    `| turns with a serious error | ${pct(point.anySerious)} | ${interval(ci.anySerious)} |`,
    `| turns with any error (incl. minor) | ${pct(point.anyMinorOrWorse)} | ${interval(ci.anyMinorOrWorse)} |`,
    ...ORIGINS.map(
      (o) =>
        `| turns with a serious ${o} error | ${pct(point[`turns:${o}`])} | ${interval(ci[`turns:${o}`])} |`,
    ),
    ...ORIGINS.map(
      (o) =>
        `| share of serious errors: ${o} | ${pct(point[`errors:${o}`])} | ${interval(ci[`errors:${o}`])} |`,
    ),
    `| terminology within mt | ${pct(point['mt:terminology'])} | ${interval(ci['mt:terminology'])} |`,
    '',
  ];
  return { text: rows.join('\n'), point, ci };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  const { model, byId } = loadJudgements(flag('--run'));
  const turns = judgedTurns(readJsonl(flag('--turns')), byId);
  const all = table('All turns', turns);
  const out = [
    `# Translation error sources: ${model}`,
    '',
    `Verdict: ${verdict(all.point, all.ci)}`,
    '',
    `Agreement (majority label): ${pct(turns.filter((t) => t.agreed).length / turns.length)}; ` +
      `turns without a Scribe source: ${turns.filter((t) => t.scribeMissing).length}; ` +
      `conversations: ${new Set(turns.map((t) => t.conv)).size}`,
    '',
    all.text,
  ];
  for (const direction of [...new Set(turns.map((t) => t.direction))].sort()) {
    out.push(
      table(
        direction,
        turns.filter((t) => t.direction === direction),
      ).text,
    );
  }
  out.push(
    table(
      'Short turns (≤ 4 words)',
      turns.filter((t) => t.short),
    ).text,
  );
  out.push(
    table(
      'Longer turns',
      turns.filter((t) => !t.short),
    ).text,
  );
  console.log(out.join('\n'));
}
