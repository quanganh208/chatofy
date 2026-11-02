// What one window of the API log cost: cloud LLM calls and billed tokens per
// turn, by kind and lane, plus the waste the cuts in this directory target.
//
//   docker logs chatofy_prod_api --since <ISO> --until <ISO> 2>&1 \
//     | node benchmarks/call-budget/analyze.mjs > results/<tag>/summary.md
//
// Reads stdin, writes Markdown to stdout, writes nothing to disk. It parses the
// `llm kind=…` lines `apps/api/src/modules/translate/providers/llm-call-log.ts`
// writes, the `TurnMetricsRecorder` turn lines, and the existing correction
// lines. No line carries transcript text, so neither does this report.
import { fileURLToPath } from 'node:url';

const ANSI = /\x1b\[[0-9;]*m/g;

/** `key=value` pairs of an `llm …` line, or null when the line is not one. */
export function parseLlmLine(line) {
  const at = line.indexOf('llm kind=');
  if (at < 0) return null;
  const fields = {};
  for (const pair of line
    .slice(at + 4)
    .trim()
    .split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const num = (value) => (value === undefined || value === '-' ? undefined : Number(value));
  return {
    kind: fields.kind,
    purpose: fields.purpose === '-' ? undefined : fields.purpose,
    host: fields.host,
    model: fields.model,
    ms: num(fields.ms),
    ok: fields.ok === '1',
    in: num(fields.in),
    out: num(fields.out),
    cached: num(fields.cached),
    h: fields.h,
  };
}

/** Server turn lines only; the client's own `turn <id> client outcome=` lines are not turns. */
const TURN = /TurnMetricsRecorder\]\s+turn (\S+) (ok|FAILED)/;
const START = /TranslationSessionService\]\s+session\.start (\S+)/;
const TRANSLATED = /translated=(\d+)ms/;
const SPECULATION = /speculation=(hit|miss)\/(\d+)/;
const HOMOPHONES = /homophones\([^)]*\) \d+ms accepted=(\d+)/;
const FUSION = /fusion\([^)]*\) \d+ms accepted=(\d+)/;
const CLIENT_CUT = /TurnMetricsRecorder\]\s+turn (\S+) client outcome=.*cut=(forced|hangover)/;

function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** Every number the summary prints, from the raw log text. */
export function analyze(text) {
  const turns = new Set();
  const starts = new Set();
  const translatedMs = [];
  const speculation = { hit: 0, miss: 0, wasted: 0, spent: 0 };
  const calls = [];
  let late = 0;
  let homophoneLines = 0;
  let homophonesAccepted = 0;
  let fusionLines = 0;
  let fusionAccepted = 0;
  // turn id → `hit|miss/K`, and turn id → how the client closed it.
  const guessByTurn = new Map();
  const cutByTurn = new Map();

  for (const raw of text.split('\n')) {
    const line = raw.replace(ANSI, '');
    const llm = parseLlmLine(line);
    if (llm) {
      calls.push(llm);
      continue;
    }
    const start = START.exec(line);
    if (start) starts.add(start[1]);
    if (line.includes('correction late, dropped')) late += 1;
    const homophones = HOMOPHONES.exec(line);
    if (homophones) {
      homophoneLines += 1;
      homophonesAccepted += Number(homophones[1]);
    }
    const fusion = FUSION.exec(line);
    if (fusion) {
      fusionLines += 1;
      fusionAccepted += Number(fusion[1]);
    }
    const cut = CLIENT_CUT.exec(line);
    if (cut) cutByTurn.set(cut[1], cut[2]);
    const turn = TURN.exec(line);
    if (!turn || line.includes('client outcome=')) continue;
    turns.add(turn[1]);
    const translated = TRANSLATED.exec(line);
    if (translated) translatedMs.push(Number(translated[1]));
    const guess = SPECULATION.exec(line);
    if (guess) {
      const spent = Number(guess[2]);
      speculation[guess[1]] += 1;
      guessByTurn.set(turn[1], `${guess[1]}/${guess[2]}`);
      speculation.spent += spent;
      // On a hit the last guess is the answer and every earlier one was not;
      // on a miss every guess was thrown away.
      speculation.wasted += guess[1] === 'hit' ? Math.max(0, spent - 1) : spent;
    }
  }

  const groups = new Map();
  const seen = new Set();
  let duplicates = 0;
  let translateCalls = 0;
  let unmetered = 0;
  for (const call of calls) {
    const key = `${call.kind}/${call.purpose ?? '-'}`;
    const group = groups.get(key) ?? { calls: 0, in: 0, out: 0, cached: 0, failed: 0 };
    group.calls += 1;
    group.in += call.in ?? 0;
    group.out += call.out ?? 0;
    group.cached += call.cached ?? 0;
    if (!call.ok) group.failed += 1;
    groups.set(key, group);
    if (call.in === undefined && call.out === undefined) unmetered += 1;
    if (call.kind === 'translate') {
      translateCalls += 1;
      if (seen.has(call.h)) duplicates += 1;
      seen.add(call.h);
    }
  }

  // Where the guesses land, split by how the turn ended: a turn the speaker
  // ended and a turn the 8 s ceiling cut behave differently, and a single
  // histogram over both hides which one wastes the calls.
  const guessesByCut = {};
  for (const [id, outcome] of guessByTurn) {
    const cut = cutByTurn.get(id) ?? 'unknown';
    guessesByCut[cut] ??= {};
    guessesByCut[cut][outcome] = (guessesByCut[cut][outcome] ?? 0) + 1;
  }

  const sorted = [...translatedMs].sort((a, b) => a - b);
  const billed = calls.reduce((sum, call) => sum + (call.in ?? 0) + (call.out ?? 0), 0);
  return {
    turns: turns.size,
    starts: starts.size,
    calls: calls.length,
    callsPerTurn: turns.size ? calls.length / turns.size : undefined,
    billedTokensPerTurn: turns.size ? billed / turns.size : undefined,
    unmetered,
    groups,
    duplicates,
    translateCalls,
    late,
    homophoneLines,
    homophonesAccepted,
    fusionLines,
    fusionAccepted,
    guessesByCut,
    translatedP50: percentile(sorted, 50),
    translatedP95: percentile(sorted, 95),
    speculation,
  };
}

const fixed = (value, digits = 2) => (value === undefined ? 'n/a' : value.toFixed(digits));
const share = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');

/** The Markdown summary for one window. */
export function render(result) {
  const lines = [
    '# Call budget for one log window',
    '',
    `turns=${result.turns}`,
    `starts=${result.starts}`,
    // A turn started and never ended: a tab closed mid-listen writes
    // `session.disconnect` and no turn line, though it may have spent calls.
    `unended=${Math.max(0, result.starts - result.turns)}`,
    `calls=${result.calls}`,
    `calls/turn=${fixed(result.callsPerTurn)}`,
    `billed tokens/turn=${fixed(result.billedTokensPerTurn, 0)} (${result.unmetered} of ${result.calls} calls carried no token counts)`,
    `translated p50=${result.translatedP50 ?? 'n/a'}ms p95=${result.translatedP95 ?? 'n/a'}ms`,
    '',
    '| kind/purpose | calls | share | calls/turn | in | out | cached | failed |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const rows = [...result.groups.entries()].sort((a, b) => b[1].calls - a[1].calls);
  for (const [key, group] of rows) {
    lines.push(
      `| ${key} | ${group.calls} | ${share(group.calls, result.calls)} | ` +
        `${fixed(result.turns ? group.calls / result.turns : undefined)} | ${group.in} | ${group.out} | ` +
        `${group.cached} | ${group.failed} |`,
    );
  }
  const { speculation } = result;
  lines.push(
    '',
    `duplicate prompts: ${result.duplicates} of ${result.translateCalls} translate calls (${share(result.duplicates, result.translateCalls)})`,
    `speculation: hit=${speculation.hit} miss=${speculation.miss} spent=${speculation.spent} wasted=${speculation.wasted} (${share(speculation.wasted, result.translateCalls)} of translate calls)`,
    `homophones: ${result.homophoneLines} answered, ${result.homophonesAccepted} corrections accepted`,
    `fusion: ${result.fusionLines} answered, ${result.fusionAccepted} corrections accepted`,
    ...Object.entries(result.guessesByCut)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([cut, outcomes]) =>
          `guesses on ${cut} turns: ${Object.entries(outcomes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([outcome, count]) => `${outcome}×${count}`)
            .join(' ')}`,
      ),
    `corrections late, dropped: ${result.late}`,
    '',
  );
  return lines.join('\n');
}

async function main() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(render(analyze(text)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
