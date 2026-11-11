// Per-stage turn latency, read off the API log of one replay run and joined to
// that run's rows.
//
//   node benchmarks/latency/analyze-latency.mjs --run baseline-voice
//   node benchmarks/latency/analyze-latency.mjs --gate open-phase2 --baseline baseline-voice
//   node benchmarks/latency/analyze-latency.mjs --gate phase2 --baseline baseline-voice --run phase2-voice
//   node benchmarks/latency/analyze-latency.mjs --self-test
//
// A run is `results/<tag>/`: `rows.jsonl` written by `replay-latency.mts`, and
// `api.log`, the API log for the run's window (README). Only the
// `TurnMetricsRecorder` turn lines whose session id is in `rows.jsonl` are
// read, so a line from anybody else in the window is never counted; the rows
// give each turn its source language, which the log line does not carry.
//
// Every stage is ms from the moment the server received `end()`; a stage a
// reused speculation reached first is negative. `alternateWait` is a duration.
//
// Gates exit 0 on PASS, 1 on FAIL and 2 on INSUFFICIENT (a cell under
// MIN_CELL turns). The conditions are the phase files' own, one row each in
// GATES below. Nothing here carries or prints transcript text.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANSI = /\x1b\[[0-9;]*m/g;
/** A cell with fewer turns than this gets no verdict. */
export const MIN_CELL = 15;

/** The log line's stage order (`TURN_STAGES` in `turn-timeline.ts`). */
export const STAGES = [
  'sttDone',
  'alternateWait',
  'mtFirstToken',
  'mtDone',
  'restoreDone',
  'correctionsDone',
  'translationsReady',
  'lineSent',
  'embeddingDone',
  'ttsRequested',
];

const TURN = /TurnMetricsRecorder\]\s+turn (\S+) (ok|FAILED)(?: \(([^)]*)\))? (.*)$/;

/** One server turn line as an object, or null when the line is not one. */
export function parseTurnLine(raw) {
  const line = raw.replace(ANSI, '');
  const match = TURN.exec(line);
  if (!match || match[4].startsWith('client ')) return null;
  const [, sessionId, status, reason, rest] = match;
  const fields = {};
  for (const pair of rest.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const ms = (value) => (value === undefined ? undefined : Number(value.replace(/ms$/, '')));
  const stages = {};
  for (const entry of (fields.stages ?? '').split(',').filter(Boolean)) {
    const [stage, value] = entry.split(':');
    if (stage && value !== undefined && Number.isFinite(Number(value)))
      stages[stage] = Number(value);
  }
  return {
    sessionId,
    ok: status === 'ok',
    reason: reason ?? null,
    firstAudio: ms(fields.firstAudio),
    lastAudio: ms(fields.lastAudio),
    translated: ms(fields.translated),
    speculation: (fields.speculation ?? '').split('/')[0] || null,
    final: fields.final ?? null,
    stages,
    hasStages: fields.stages !== undefined,
    inflight: fields.inflight === 'yes',
    corrLate: fields.corrLate === 'yes',
    // `yes|no` from `end()`: whether the audio could hold a change of voice.
    // Null on a turn that never got that far, and on lines written before it.
    cand: fields.cand ?? null,
    // Fusion corrections the final line carried; null when no fusion ran.
    fused: fields.fused === undefined ? null : Number(fields.fused),
  };
}

/** `vi→en` and `en→vi` for the conversation pair; anything else as heard. */
const directionOf = (language) =>
  language === 'vi' ? 'vi→en' : language === 'en' ? 'en→vi' : (language ?? 'unknown');

/**
 * The run as joined turns: each server turn line with its row's language.
 * `rows` are the parsed `rows.jsonl` objects, `logText` the API log window.
 */
export function joinRun(rows, logText) {
  const bySession = new Map(rows.filter((row) => row.sessionId).map((row) => [row.sessionId, row]));
  const turns = [];
  for (const raw of logText.split('\n')) {
    const turn = parseTurnLine(raw);
    const row = turn && bySession.get(turn.sessionId);
    if (!row) continue;
    turns.push({
      ...turn,
      language: row.language ?? null,
      direction: directionOf(row.language),
      row,
    });
  }
  // Counted per joined turn, so another user's traffic, a discarded guess and
  // a correction dropped as late never count.
  const fusionApplied = turns.filter((turn) => (turn.fused ?? 0) > 0).length;
  return { rows, turns, fusionApplied };
}

/** Values the analysis derives from the stage map, where both ends exist. */
export const DERIVED = {
  /** Display restore plus corrections: what speech waits for after the translation. */
  restoreAndCorrections: (s) => diff(s.translationsReady, s.mtDone),
  /** The embedding's hold on speech while speech starts after the line. */
  embeddingAfterLine: (s) => clampedDiff(s.embeddingDone, s.lineSent),
  /** The same hold once speech starts at the translation. */
  embeddingAfterMt: (s) => clampedDiff(s.embeddingDone, s.mtDone),
  /** How long the translation streams after its first token. */
  mtStream: (s) => diff(s.mtDone, s.mtFirstToken),
};
function diff(a, b) {
  return a === undefined || b === undefined ? undefined : a - b;
}
function clampedDiff(a, b) {
  const d = diff(a, b);
  return d === undefined ? undefined : Math.max(0, d);
}

/** A turn's first audio, only where it is a real measurement (voiced and delivered). */
const firstAudioOf = (turn) => (turn.ok && turn.reason === null ? turn.firstAudio : undefined);

/** A metric by name: a stage, a derived value, `firstAudio` or `lastAudio`. */
export function metric(turn, name) {
  if (name === 'firstAudio') return firstAudioOf(turn);
  if (name === 'lastAudio') return firstAudioOf(turn) === undefined ? undefined : turn.lastAudio;
  if (DERIVED[name]) return DERIVED[name](turn.stages);
  return turn.stages[name];
}

/** Nearest-rank percentile, as `benchmarks/call-budget/analyze.mjs` takes it. */
export function percentile(values, p) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** p50 of `name` over `turns`, with how many turns carried it. */
function p50(turns, name) {
  const values = turns.map((turn) => metric(turn, name)).filter((v) => v !== undefined);
  return { n: values.length, p50: percentile(values, 50) };
}

/** Turns a gate may read: those that reached the translation (`mtDone`). */
const gateable = (turns) => turns.filter((turn) => turn.stages.mtDone !== undefined);
const isSplit = (turn) => turn.final === 'split';
/**
 * The plain path: no split candidate at `end()`. The speech and embedding
 * changes touch only these turns, so their cells read only these turns.
 */
const plain = (turn) => turn.cand === 'no';
const isCandidate = (turn) => turn.cand === 'yes';
const miss = (turn) => turn.speculation === 'miss';
const hit = (turn) => turn.speculation === 'hit';

/** One gate cell: INSUFFICIENT under MIN_CELL turns, else the p50 checked. */
function cellAtLeast(label, turns, name, threshold) {
  const { n, p50: value } = p50(turns, name);
  if (n < MIN_CELL)
    return { verdict: 'INSUFFICIENT', text: `${label}: ${name} n=${n} (< ${MIN_CELL})` };
  const verdict = value >= threshold ? 'PASS' : 'FAIL';
  return { verdict, text: `${label}: ${name} p50=${value}ms n=${n}, needs >= ${threshold}ms` };
}

/** A drop in `name` from baseline to run of at least `needed` ms, in one cell. */
function dropAtLeast(label, base, run, name, needed) {
  const before = p50(base, name);
  const after = p50(run, name);
  if (before.n < MIN_CELL || after.n < MIN_CELL) {
    return {
      verdict: 'INSUFFICIENT',
      text: `${label}: ${name} n=${before.n}/${after.n} (< ${MIN_CELL})`,
    };
  }
  const drop = before.p50 - after.p50;
  return {
    verdict: drop >= needed ? 'PASS' : 'FAIL',
    text: `${label}: ${name} p50 ${before.p50}→${after.p50}ms (drop ${drop}ms, needs >= ${Math.round(needed)}ms; n=${before.n}/${after.n})`,
  };
}

const share = (turns, test) => (turns.length === 0 ? 0 : turns.filter(test).length / turns.length);

/** Combine checks: any INSUFFICIENT wins, then any FAIL, else PASS. */
function all(checks) {
  const verdict = checks.some((c) => c.verdict === 'INSUFFICIENT')
    ? 'INSUFFICIENT'
    : checks.some((c) => c.verdict === 'FAIL')
      ? 'FAIL'
      : 'PASS';
  return { verdict, lines: checks.map((c) => c.text) };
}

/**
 * Every gate in the plan, one row each. `base` and `run` are `joinRun` results.
 * The conditions are copied from the phase files; read those for why.
 */
export const GATES = {
  // Restore + corrections hold non-reused voiced turns >= 100 ms at p50.
  'open-phase2': ({ base }) => {
    const cell = gateable(base.turns).filter((t) => plain(t) && miss(t));
    return all([
      cellAtLeast('cand=no miss', cell, 'restoreAndCorrections', 100),
      note(
        `split-candidate share ${(share(base.turns, isCandidate) * 100).toFixed(1)}% of ${base.turns.length} turns`,
      ),
    ]);
  },
  // Embedding wait >= 50 ms p50 in either reuse cell (non-split).
  'open-phase3': ({ base, options }) => {
    const name = options.phase2Shipped ? 'embeddingAfterMt' : 'embeddingAfterLine';
    const nonSplit = gateable(base.turns).filter(plain);
    const cells = [
      cellAtLeast('cand=no hit', nonSplit.filter(hit), name, 50),
      cellAtLeast('cand=no miss', nonSplit.filter(miss), name, 50),
    ];
    // Either cell opens it; an unmeasurable cell only matters when no other passes.
    const verdict = cells.some((c) => c.verdict === 'PASS')
      ? 'PASS'
      : cells.some((c) => c.verdict === 'INSUFFICIENT')
        ? 'INSUFFICIENT'
        : 'FAIL';
    return { verdict, lines: cells.map((c) => c.text) };
  },
  // Alternate wait >= 80 ms p50 on vi-source miss turns.
  'open-phase4': ({ base }) =>
    all([
      cellAtLeast(
        'vi miss',
        gateable(base.turns).filter((t) => miss(t) && t.language === 'vi'),
        'alternateWait',
        80,
      ),
      note('also requires Phase 2 shipped or cancelled by its gate (not in the log)'),
    ]),
  // Translation streams >= 400 ms past its first token, p50, on miss turns.
  'open-phase5': ({ base }) =>
    all([cellAtLeast('miss', gateable(base.turns).filter(miss), 'mtStream', 400)]),

  // First audio drops >= 70% of the baseline restore + corrections wait; the
  // line rises <= 20 ms; late corrections do not rise.
  phase2: ({ base, run }) => {
    const cell = (j) => gateable(j.turns).filter((t) => plain(t) && miss(t));
    const wait = p50(cell(base), 'restoreAndCorrections');
    return all([
      dropAtLeast(
        'cand=no miss',
        cell(base),
        cell(run),
        'firstAudio',
        0.7 * (wait.p50 ?? Infinity),
      ),
      riseAtMost('cand=no miss', cell(base), cell(run), 'lineSent', 20),
      shareAtMost('cand=no miss corrLate=yes', cell(base), cell(run), (t) => t.corrLate),
    ]);
  },
  // First audio drops >= 70% of the baseline embedding wait, in each reuse
  // cell where that wait was >= 50 ms.
  phase3: ({ base, run, options }) => {
    const name = options.phase2Shipped ? 'embeddingAfterMt' : 'embeddingAfterLine';
    const nonSplit = (j, test) => gateable(j.turns).filter((t) => plain(t) && test(t));
    const checks = [];
    for (const [label, test] of [
      ['cand=no hit', hit],
      ['cand=no miss', miss],
    ]) {
      const wait = p50(nonSplit(base, test), name);
      // A cell too small to say whether its wait was >= 50ms cannot be passed
      // over as if it were under it.
      if (wait.n < MIN_CELL) {
        checks.push({
          verdict: 'INSUFFICIENT',
          text: `${label}: baseline ${name} n=${wait.n} (< ${MIN_CELL})`,
        });
        continue;
      }
      if (wait.p50 < 50) continue;
      checks.push(
        dropAtLeast(label, nonSplit(base, test), nonSplit(run, test), 'firstAudio', 0.7 * wait.p50),
      );
    }
    if (checks.length === 0)
      return { verdict: 'FAIL', lines: ['no reuse cell had a baseline embedding wait >= 50ms'] };
    return all(checks);
  },
  // The line drops >= 70% of the baseline alternate wait on vi miss turns;
  // fusion-applied turns stay >= 90% of the baseline count.
  phase4: ({ base, run }) => {
    const cell = (j) => gateable(j.turns).filter((t) => miss(t) && t.language === 'vi');
    const wait = p50(cell(base), 'alternateWait');
    const fusionOk = run.fusionApplied >= 0.9 * base.fusionApplied;
    return all([
      dropAtLeast('vi miss', cell(base), cell(run), 'lineSent', 0.7 * (wait.p50 ?? Infinity)),
      {
        verdict: fusionOk ? 'PASS' : 'FAIL',
        text: `fusion-applied turns (fused>0) ${base.fusionApplied}→${run.fusionApplied}, needs >= 90% of baseline`,
      },
    ]);
  },
  // First audio drops >= 200 ms on miss multi-clause turns; the spoken text
  // matches the line on every turn without a restart. Both read row fields
  // the clause-streaming change adds to the replay: `multiClause`,
  // `spokenMatchesLine`, `restart`.
  phase5: ({ base, run }) => {
    const multi = (j) => gateable(j.turns).filter((t) => miss(t) && t.row.multiClause === true);
    const checked = run.turns.filter((t) => t.row.restart !== true);
    const unknown = checked.filter((t) => typeof t.row.spokenMatchesLine !== 'boolean').length;
    const mismatched = checked.filter((t) => t.row.spokenMatchesLine === false).length;
    return all([
      dropAtLeast('miss multi-clause', multi(base), multi(run), 'firstAudio', 200),
      {
        verdict:
          checked.length >= MIN_CELL
            ? unknown === 0 && mismatched === 0
              ? 'PASS'
              : 'FAIL'
            : 'INSUFFICIENT',
        text: `spokenMatchesLine: ${checked.length - unknown - mismatched}/${checked.length} true (${unknown} unrecorded)`,
      },
    ]);
  },
  // engine_busy under 5% of turns; a baseline already under 5% means the
  // harness does not reproduce the problem and cannot prove a fix.
  phase6: ({ base, run }) => {
    const busy = (j) => share(j.turns, (t) => t.reason === 'engine_busy');
    const checks = [];
    for (const [label, j] of [
      ['baseline', base],
      ['run', run],
    ]) {
      if (j.turns.length < MIN_CELL) {
        checks.push({
          verdict: 'INSUFFICIENT',
          text: `${label}: n=${j.turns.length} (< ${MIN_CELL})`,
        });
      }
    }
    const before = busy(base);
    const after = busy(run);
    checks.push({
      verdict: before >= 0.05 ? 'PASS' : 'FAIL',
      text: `baseline engine_busy ${(before * 100).toFixed(1)}%: must be >= 5% for the harness to show the problem`,
    });
    checks.push({
      verdict: after < 0.05 ? 'PASS' : 'FAIL',
      text: `run engine_busy ${(after * 100).toFixed(1)}% of ${run.turns.length}, needs < 5%`,
    });
    checks.push(
      note('restart counts, mem_limit and host memory are checked by hand (not in the log)'),
    );
    return all(checks);
  },
};

function note(text) {
  return { verdict: 'PASS', text: `note: ${text}` };
}
function riseAtMost(label, base, run, name, allowed) {
  const before = p50(base, name);
  const after = p50(run, name);
  if (before.n < MIN_CELL || after.n < MIN_CELL) {
    return {
      verdict: 'INSUFFICIENT',
      text: `${label}: ${name} n=${before.n}/${after.n} (< ${MIN_CELL})`,
    };
  }
  const rise = after.p50 - before.p50;
  return {
    verdict: rise <= allowed ? 'PASS' : 'FAIL',
    text: `${label}: ${name} p50 ${before.p50}→${after.p50}ms (rise ${rise}ms, allowed <= ${allowed}ms)`,
  };
}
/** The share of `test` turns in a cell must not rise from baseline to run. */
export function shareAtMost(label, base, run, test) {
  if (base.length < MIN_CELL || run.length < MIN_CELL) {
    return {
      verdict: 'INSUFFICIENT',
      text: `${label}: n=${base.length}/${run.length} (< ${MIN_CELL})`,
    };
  }
  const before = share(base, test);
  const after = share(run, test);
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  return {
    verdict: after <= before ? 'PASS' : 'FAIL',
    text: `${label}: ${pct(before)}→${pct(after)} of turns (n=${base.length}/${run.length}), must not rise`,
  };
}

/** Gate names that need a `--run` beside the baseline. */
const needsRun = (gate) => !gate.startsWith('open-');

/** Evaluate one gate; returns `{ verdict, lines }`. */
export function evaluate(gate, base, run, options = {}) {
  const check = GATES[gate];
  if (!check) throw new Error(`unknown gate ${gate}; one of ${Object.keys(GATES).join(', ')}`);
  if (needsRun(gate) && !run) throw new Error(`--gate ${gate} needs --run <tag>`);
  return check({ base, run, options });
}

const EXIT = { PASS: 0, FAIL: 1, INSUFFICIENT: 2 };

/** The Markdown tables for one run. */
export function report(joined) {
  const { turns } = joined;
  const out = [];
  const columns = ['translated', ...STAGES, ...Object.keys(DERIVED), 'firstAudio', 'lastAudio'];
  out.push(`turns=${turns.length} rows=${joined.rows.length}`, '');
  out.push('## Stage coverage', '', '| stage | turns |', '|---|---|');
  for (const stage of STAGES)
    out.push(`| ${stage} | ${turns.filter((t) => t.stages[stage] !== undefined).length} |`);
  out.push('');
  out.push(`corrLate=yes: ${turns.filter((t) => t.corrLate).length}`);
  out.push(
    `alternateWait >= 100ms: ${turns.filter((t) => (t.stages.alternateWait ?? -1) >= 100).length}`,
  );
  out.push(
    `split-candidate turns (cand=yes): ${turns.filter(isCandidate).length} (${(share(turns, isCandidate) * 100).toFixed(1)}%); actually split (final=split): ${turns.filter(isSplit).length}`,
  );
  out.push(`fusion-applied turns (fused>0): ${joined.fusionApplied}`);
  out.push(
    `speculation hit in flight at end: ${turns.filter((t) => hit(t) && t.inflight).length} of ${turns.filter(hit).length} hits`,
  );
  out.push(
    `turns left out of gate cells (no mtDone): ${turns.length - gateable(turns).length}`,
    '',
  );

  const cells = new Map();
  for (const turn of gateable(turns)) {
    const key = `${turn.speculation ?? '-'} | ${turn.direction} | ${isSplit(turn) ? 'split' : 'whole'}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(turn);
  }
  out.push(
    '## p50 / p95 by cell (ms)',
    '',
    'Cell is speculation | direction | final=split or not; every cell prints its n.',
    '',
  );
  for (const [key, cell] of [...cells.entries()].sort()) {
    out.push(
      `### ${key} (n=${cell.length})`,
      '',
      '| metric | n | p50 | p95 |',
      '|---|---|---|---|',
    );
    for (const name of columns) {
      const values = cell.map((t) => metric(t, name)).filter((v) => v !== undefined);
      if (values.length === 0) continue;
      out.push(
        `| ${name} | ${values.length} | ${percentile(values, 50)} | ${percentile(values, 95)} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

function readRun(dir, tag, logOverride) {
  const base = join(dir, tag);
  const rowsPath = join(base, 'rows.jsonl');
  const logPath = logOverride ?? join(base, 'api.log');
  for (const path of [rowsPath, logPath]) {
    if (!existsSync(path)) throw new Error(`${path} is missing; see benchmarks/latency/README.md`);
  }
  const rows = readFileSync(rowsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  return joinRun(rows, readFileSync(logPath, 'utf8'));
}

const HELP = `Usage: node benchmarks/latency/analyze-latency.mjs [flags]

  --run <tag>              print the tables for results/<tag> (rows.jsonl + api.log)
  --gate <name>            evaluate a gate: ${Object.keys(GATES).join(', ')}
  --baseline <tag>         the baseline run a gate reads
  --run <tag>              with --gate phaseN: the run compared to the baseline
  --log <file>             read the API log from <file> instead of results/<tag>/api.log
                           (table mode only)
  --results-dir <dir>      where the run folders are (default benchmarks/latency/results)
  --phase2-shipped         open-phase3/phase3: measure the embedding wait from mtDone
  --self-test              run the built-in fixture checks
  --help                   print this and exit

Gates print PASS, FAIL or INSUFFICIENT and exit 0, 1 or 2.`;

function parseArgs(argv) {
  const args = { resultsDir: join(HERE, 'results'), phase2Shipped: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--help') args.help = true;
    else if (flag === '--self-test') args.selfTest = true;
    else if (flag === '--run') args.run = next();
    else if (flag === '--gate') args.gate = next();
    else if (flag === '--baseline') args.baseline = next();
    else if (flag === '--log') args.log = next();
    else if (flag === '--results-dir') args.resultsDir = next();
    else if (flag === '--phase2-shipped') args.phase2Shipped = true;
    else throw new Error(`unknown flag ${flag}; --help lists them`);
  }
  return args;
}

// ---- self-test: fixture lines and rows, one PASS, one FAIL, one INSUFFICIENT.

/** A turn line as the recorder writes it. */
function fixtureLine(
  id,
  { spec = 'miss', final = 'fresh', stages, reason, cand = 'no', fused, corrLate = 'no' },
) {
  const list = Object.entries(stages)
    .map(([stage, value]) => `${stage}:${value}`)
    .join(',');
  return (
    `[Nest] 1  - 11/10/2026, 5:46:42 PM     LOG [TurnMetricsRecorder] turn ${id} ok${reason ? ` (${reason})` : ''} ` +
    `firstAudio=900ms translated=500ms clauses=1/stream speculation=${spec}/1 live=0 ` +
    `final=${final} bytes=1000 specAt=- chars=10 words=2 speechMs=- ` +
    `lastAudio=1800ms stages=${list} inflight=no corrLate=${corrLate} cand=${cand}` +
    (fused === undefined ? '' : ` fused=${fused}`)
  );
}

function fixtureRun(
  count,
  wait,
  { language = 'vi', cand = 'no', fused, lateEvery = 0, embedding } = {},
) {
  const rows = [];
  const lines = [
    '[Nest] noise line',
    '[TurnMetricsRecorder] turn stranger ok firstAudio=1ms translated=1ms',
  ];
  for (let i = 0; i < count; i += 1) {
    const id = `s${i}`;
    rows.push({ sessionId: id, language, split: false });
    lines.push(
      fixtureLine(id, {
        cand,
        fused,
        corrLate: lateEvery > 0 && i % lateEvery === 0 ? 'yes' : 'no',
        stages: {
          sttDone: 100,
          alternateWait: 90,
          mtDone: 400,
          translationsReady: 400 + wait,
          lineSent: 420 + wait,
          ...(embedding === undefined ? {} : { embeddingDone: 420 + wait + embedding }),
        },
      }),
    );
  }
  return joinRun(rows, lines.join('\n'));
}

function selfTest() {
  // The parser reads every field the gates use, and ignores client lines.
  const parsed = parseTurnLine(
    fixtureLine('a', {
      spec: 'hit',
      final: 'split',
      stages: { sttDone: -40, mtDone: 12 },
      reason: 'voice_off',
    }),
  );
  assert.deepEqual(parsed.stages, { sttDone: -40, mtDone: 12 });
  assert.equal(parsed.speculation, 'hit');
  assert.equal(parsed.final, 'split');
  assert.equal(parsed.reason, 'voice_off');
  assert.equal(metric(parsed, 'firstAudio'), undefined, 'a voice-off turn has no first audio');
  assert.equal(
    parseTurnLine('[TurnMetricsRecorder] turn a client outcome=played captured=1ms'),
    null,
  );
  assert.equal(percentile([5, 1, 3], 50), 3);

  // Only rows of the run are joined; the stranger's line is not.
  const run = fixtureRun(20, 150);
  assert.equal(run.turns.length, 20);

  const pass = evaluate('open-phase2', run);
  assert.equal(pass.verdict, 'PASS', pass.lines.join('\n'));
  const fail = evaluate('open-phase2', fixtureRun(20, 40));
  assert.equal(fail.verdict, 'FAIL', fail.lines.join('\n'));
  const insufficient = evaluate('open-phase4', fixtureRun(10, 150));
  assert.equal(insufficient.verdict, 'INSUFFICIENT', insufficient.lines.join('\n'));
  // A gate comparing two runs: first audio did not move, so phase 2 fails.
  assert.equal(evaluate('phase2', run, fixtureRun(20, 150)).verdict, 'FAIL');
  assert.throws(() => evaluate('phase2', run), /needs --run/);

  // `cand` and `fused` are read off the line; absent `fused` is null, not 0.
  const flagged = parseTurnLine(fixtureLine('b', { stages: {}, cand: 'yes', fused: 2 }));
  assert.equal(flagged.cand, 'yes');
  assert.equal(flagged.fused, 2);
  assert.equal(parseTurnLine(fixtureLine('c', { stages: {} })).fused, null);

  // The plain-path cells read only `cand=no` turns: a run of candidates has none.
  assert.equal(
    evaluate('open-phase2', fixtureRun(20, 150, { cand: 'yes' })).verdict,
    'INSUFFICIENT',
  );

  // A phase 3 cell too small to judge makes the gate INSUFFICIENT, not FAIL.
  const small = evaluate('phase3', fixtureRun(10, 150, { embedding: 80 }), fixtureRun(10, 150));
  assert.equal(small.verdict, 'INSUFFICIENT', small.lines.join('\n'));

  // Late corrections compare as a share of the cell: 2 of 20 then 3 of 40
  // is more turns but a smaller share, and passes.
  const lateBase = fixtureRun(20, 150, { lateEvery: 10 }).turns;
  const lateRun = fixtureRun(40, 150, { lateEvery: 14 }).turns;
  assert.equal(shareAtMost('late', lateBase, lateRun, (t) => t.corrLate).verdict, 'PASS');
  assert.equal(shareAtMost('late', lateRun, lateBase, (t) => t.corrLate).verdict, 'FAIL');

  // Fusion is counted per joined turn from `fused=`.
  const fusedBase = fixtureRun(20, 150, { fused: 1 });
  assert.equal(fusedBase.fusionApplied, 20);
  const lostFusion = evaluate('phase4', fusedBase, fixtureRun(20, 150, { fused: 0 }));
  assert.ok(
    lostFusion.lines.some((line) => /fused>0\) 20→0/.test(line)),
    lostFusion.lines.join('\n'),
  );
  assert.equal(lostFusion.verdict, 'FAIL');
  console.log('self-test: ok (PASS, FAIL, INSUFFICIENT, cand, fused and share cases)');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.selfTest) {
    selfTest();
    return 0;
  }
  if (args.gate) {
    if (!args.baseline) throw new Error('--gate needs --baseline <tag>');
    const base = readRun(args.resultsDir, args.baseline);
    const run = args.run ? readRun(args.resultsDir, args.run) : undefined;
    const { verdict, lines } = evaluate(args.gate, base, run, {
      phase2Shipped: args.phase2Shipped,
    });
    console.log(`${args.gate}: ${verdict}`);
    for (const line of lines) console.log(`  ${line}`);
    return EXIT[verdict];
  }
  if (args.run) {
    console.log(report(readRun(args.resultsDir, args.run, args.log)));
    return 0;
  }
  console.log(HELP);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
