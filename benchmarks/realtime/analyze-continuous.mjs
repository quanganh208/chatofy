// Turns the JSONL metrics sink into the numbers continuous capture is judged on.
//
// The file is written by `TurnMetricsRecorder` when `TURN_METRICS_PATH` is set. It
// interleaves two kinds of row, told apart by `source`:
//
//   server — what a turn cost: requests spent, stage timings from the endpoint on
//   client — what the listener experienced: when speech began, when sound came out
//
// They are joined on `sessionId` and NEVER by timestamp. The two sides keep their
// own clocks and nothing here subtracts one from the other; a client's epoch may be
// minutes off the server's and it would not show up as an error, only as a plausible
// wrong answer.
//
// Usage:
//   node benchmarks/realtime/analyze-continuous.mjs turns.jsonl
//   node benchmarks/realtime/analyze-continuous.mjs turns.jsonl --speech-ms 174300
//   node benchmarks/realtime/analyze-continuous.mjs turns.jsonl --json
//
// `--speech-ms` is the coverage denominator, and it must come from
// `vad-reference.mjs` run over the recording — not from this file. Deriving it from
// the gate's own output would make coverage circular: speech the gate missed would
// leave both the numerator and the denominator, and a gate that heard nothing at all
// would score 100%.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Free-tier ceiling, per model, per minute. */
const REQUESTS_PER_MINUTE_LIMIT = 15;

/** Drift is read at these marks, to answer whether the line is flat or climbing. */
const DRIFT_MARKS_MIN = [1, 3, 5];

function parseRows(path) {
  const rows = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    try {
      rows.push(JSON.parse(text));
    } catch {
      console.warn(`skipped unparseable line ${index + 1}`);
    }
  });
  return rows;
}

/**
 * Group rows by turn.
 *
 * Rows written before the `source` field existed are server rows: that field was
 * added with the client channel, so its absence identifies the older shape rather
 * than an unknown one.
 */
function joinTurns(rows) {
  const turns = new Map();
  for (const row of rows) {
    if (!row.sessionId) continue;
    const turn = turns.get(row.sessionId) ?? { sessionId: row.sessionId };
    if (row.source === 'client') turn.client = row;
    else turn.server = row;
    turns.set(row.sessionId, turn);
  }
  return [...turns.values()];
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
}

/**
 * Requests spent per model, from the server rows.
 *
 * Per model because the free tier meters per model and the two are NOT
 * interchangeable: `gemini-3.5-flash-lite` takes the live translations and the final
 * one, `gemini-3.1-flash-lite` takes the speculations. Summing them into one figure
 * hides the fact that either can hit its own ceiling while the total looks fine.
 *
 * The mapping mirrors `session/translation-model-policy.ts`. If that file's ladders
 * change, this has to change with it — which is why the model names are stated here
 * rather than inferred.
 */
function requestsByModel(turns) {
  const final = 'gemini-3.5-flash-lite';
  const speculation = 'gemini-3.1-flash-lite';
  const counts = { [final]: 0, [speculation]: 0 };

  for (const { server } of turns) {
    if (!server) continue;
    // One final translation per turn that reached the endpoint, plus every live
    // translation, both on the leader.
    counts[final] += 1 + (server.liveTranslations ?? 0);
    counts[speculation] += server.speculations ?? 0;
  }
  return counts;
}

/**
 * Bin edges for the turn-length distribution, in seconds. Upper bound exclusive,
 * with an open-ended final bin.
 */
const LENGTH_BINS_S = [0, 2, 3, 5, 7, 10];

/**
 * Commit points to evaluate, in seconds of speech.
 *
 * Not one number, because the point of the table is to CHOOSE one. A commit at
 * `t` can only help a turn longer than `t`, and it helps it by however much
 * longer it is.
 */
const COMMIT_POINTS_S = [3, 4, 5, 6];

function histogram(lengthsMs) {
  return LENGTH_BINS_S.map((low, i) => {
    const high = LENGTH_BINS_S[i + 1] ?? null;
    const count = lengthsMs.filter(
      (ms) => ms >= low * 1000 && (high === null || ms < high * 1000),
    ).length;
    return {
      label: high === null ? `>=${low}s` : `${low}-${high}s`,
      count,
      share: lengthsMs.length ? count / lengthsMs.length : null,
    };
  });
}

/**
 * What committing early would actually buy, per turn, in milliseconds.
 *
 * This — not "what share of turns run past some line" — is the quantity that
 * decides whether clause-level commitment is worth building. A commit at
 * `t_commit` removes `max(0, L - t_commit)` of the listener's wait on a turn of
 * length `L`, and averaging that over EVERY turn (not only the long ones) is
 * what stops a handful of monologues arguing for a change the ordinary turn
 * never benefits from.
 *
 * Counting turns over a threshold instead was the first version of this, and it
 * answers a question nobody asked: two runs with the same share of long turns
 * can differ several-fold in how much waiting there is to remove.
 */
function commitSavings(lengthsMs) {
  return COMMIT_POINTS_S.map((seconds) => {
    const commitMs = seconds * 1000;
    const saved = lengthsMs.map((ms) => Math.max(0, ms - commitMs));
    return {
      commitS: seconds,
      meanSavedMs: lengthsMs.length ? sum(saved) / lengthsMs.length : null,
      turnsHelped: saved.filter((ms) => ms > 0).length,
    };
  });
}

/** Wall-clock span the run covered, from the client's own marks. */
function runSpanMs(turns) {
  const starts = turns.map((t) => t.client?.speechStartedAt).filter((v) => typeof v === 'number');
  const ends = turns.map((t) => t.client?.speechEndedAt).filter((v) => typeof v === 'number');
  if (starts.length === 0 || ends.length === 0) return null;
  return Math.max(...ends) - Math.min(...starts);
}

/**
 * Drift per turn: the gap between someone speaking and the listener hearing it.
 *
 * Both marks are the client's, so this subtraction is inside one clock. Turns that
 * never played have no drift — they have an outcome instead, which is why the report
 * prints the outcome breakdown next to this rather than quietly averaging over
 * fewer turns than it says.
 */
function driftSeries(turns) {
  const series = [];
  for (const { client } of turns) {
    if (!client?.firstAudioPlayedAt || !client.speechStartedAt) continue;
    series.push({
      atMs: client.speechStartedAt,
      driftMs: client.firstAudioPlayedAt - client.speechStartedAt,
    });
  }
  return series.sort((a, b) => a.atMs - b.atMs);
}

function report(path, speechMs) {
  const rows = parseRows(path);
  const turns = joinTurns(rows);
  const clientTurns = turns.filter((t) => t.client);

  const outcomes = {};
  for (const { client } of clientTurns) {
    outcomes[client.outcome] = (outcomes[client.outcome] ?? 0) + 1;
  }

  // Every outcome, not only `played`. Summing the turns that played would measure
  // the success rate of playback rather than the coverage of capture — and it would
  // improve precisely when the pipeline was breaking.
  const capturedMs = sum(clientTurns.map((t) => t.client.capturedMs ?? 0));
  const heldMs = sum(clientTurns.map((t) => t.client.heldMs ?? 0));

  const drift = driftSeries(clientTurns);
  const firstSpeechAt = drift[0]?.atMs;
  // The MEDIAN over a trailing minute, not the last single turn. Turn lengths vary
  // — a sentence cut at the ceiling and a two-second reply drift by very different
  // amounts — so one turn's value at a mark says more about which turn happened to
  // land there than about the trend, which is the whole question being asked.
  const driftAtMarks = DRIFT_MARKS_MIN.map((minutes) => {
    if (firstSpeechAt === undefined) return { minutes, driftMs: null, turns: 0 };
    const at = firstSpeechAt + minutes * 60_000;
    const window = drift.filter((point) => point.atMs > at - 60_000 && point.atMs <= at);
    return {
      minutes,
      driftMs: percentile(
        window.map((point) => point.driftMs),
        0.5,
      ),
      turns: window.length,
    };
  });

  const spanMs = runSpanMs(clientTurns);
  const requests = requestsByModel(turns);
  const perMinute = Object.fromEntries(
    Object.entries(requests).map(([model, count]) => [
      model,
      spanMs && spanMs > 0 ? (count / spanMs) * 60_000 : null,
    ]),
  );

  const turnLengths = clientTurns
    .map((t) => (t.client.speechEndedAt ?? 0) - (t.client.speechStartedAt ?? 0))
    .filter((ms) => ms > 0);

  return {
    file: basename(path),
    turns: turns.length,
    clientRows: clientTurns.length,
    serverRows: turns.filter((t) => t.server).length,
    outcomes,
    capturedMs,
    heldMs,
    speechMs,
    coverage: speechMs ? capturedMs / speechMs : null,
    runSpanMs: spanMs,
    turnLength: {
      n: turnLengths.length,
      meanMs: turnLengths.length ? Math.round(sum(turnLengths) / turnLengths.length) : null,
      p95Ms: percentile(turnLengths, 0.95),
      // Turns the length ceiling cut rather than the speaker ending. They are
      // RIGHT-CENSORED observations: their true length is unknown and at least
      // what was recorded, so every figure below understates. Reported beside
      // the distribution rather than folded into it.
      cutForced: clientTurns.filter((t) => t.client.cutForced).length,
      histogram: histogram(turnLengths),
      commitSavings: commitSavings(turnLengths),
    },
    drift: {
      atMarks: driftAtMarks,
      p50Ms: percentile(
        drift.map((d) => d.driftMs),
        0.5,
      ),
      p95Ms: percentile(
        drift.map((d) => d.driftMs),
        0.95,
      ),
    },
    requests,
    requestsPerMinute: perMinute,
    echoEvents: sum(clientTurns.map((t) => t.client.echoEvents ?? 0)),
    quotaFailures: turns.filter((t) => t.server && t.server.completed === false).length,
  };
}

function print(r) {
  const ms = (value) => (value === null || value === undefined ? '—' : `${Math.round(value)}ms`);
  const pct = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

  console.log(`\n=== ${r.file} ===`);
  console.log(`turns: ${r.turns} (client rows ${r.clientRows}, server rows ${r.serverRows})`);
  console.log(`outcomes: ${JSON.stringify(r.outcomes)}`);

  console.log('\n--- coverage ---');
  console.log(`captured (every outcome): ${ms(r.capturedMs)}`);
  console.log(`held, never sent:         ${ms(r.heldMs)}`);
  if (r.speechMs) {
    console.log(`speech in recording:      ${ms(r.speechMs)}  (from vad-reference.mjs)`);
    console.log(`coverage:                 ${pct(r.coverage)}   target >= 95%`);
    if (r.coverage > 1) {
      console.log(
        '  Over 100%, which is not a good score — it means more audio was sent\n' +
          '  than the recording contains speech. Either the denominator is from the\n' +
          '  wrong file, or capture is forwarding non-speech. Check both before\n' +
          '  quoting this number.',
      );
    }
  } else {
    console.log('coverage:                 — pass --speech-ms from vad-reference.mjs');
  }

  console.log('\n--- turn length ---');
  console.log(
    `n ${r.turnLength.n}, mean ${ms(r.turnLength.meanMs)}, p95 ${ms(r.turnLength.p95Ms)}`,
  );
  console.log(`cut at the ceiling: ${r.turnLength.cutForced} of ${r.clientRows} (right-censored)`);
  for (const bin of r.turnLength.histogram) {
    const share = bin.share === null ? '—' : `${(bin.share * 100).toFixed(0)}%`;
    console.log(`  ${bin.label.padEnd(7)} ${String(bin.count).padStart(4)}  ${share}`);
  }

  console.log('\n--- what committing early would buy ---');
  console.log('  mean wait removed per turn, over EVERY turn, if a turn committed at:');
  for (const point of r.turnLength.commitSavings) {
    console.log(
      `  ${String(point.commitS).padStart(2)}s  ${ms(point.meanSavedMs).padStart(8)}` +
        `   (helps ${point.turnsHelped}/${r.turnLength.n} turns)`,
    );
  }
  if (r.turnLength.cutForced > 0) {
    console.log(
      '  Understated: the ceiling cut some turns short, so their real length —\n' +
        '  and the wait an early commit would have removed — is larger than recorded.',
    );
  }

  console.log('\n--- drift (speech start -> first sound) ---');
  console.log('  median over the minute ending at each mark');
  for (const mark of r.drift.atMarks) {
    console.log(
      `  at ${mark.minutes} min: ${ms(mark.driftMs)}` +
        `${mark.turns ? ` (${mark.turns} turns)` : '  no turns in window'}`,
    );
  }
  console.log(`  p50 ${ms(r.drift.p50Ms)}, p95 ${ms(r.drift.p95Ms)} over the whole run`);
  const marks = r.drift.atMarks.filter((m) => m.driftMs !== null && m.turns > 0);
  if (marks.length >= 2) {
    const climbing = marks.at(-1).driftMs > marks[0].driftMs * 1.5;
    console.log(
      `  verdict: ${
        climbing
          ? 'CLIMBING — the queue is growing and the translation falls further behind'
          : 'flat — the pipeline is keeping up'
      }`,
    );
  } else {
    console.log('  verdict: — too few turns at the marks to say');
  }

  console.log('\n--- requests per minute, PER MODEL ---');
  console.log(`  run span: ${ms(r.runSpanMs)}`);
  for (const [model, count] of Object.entries(r.requests)) {
    const rate = r.requestsPerMinute[model];
    const over = rate !== null && rate > REQUESTS_PER_MINUTE_LIMIT;
    console.log(
      `  ${model.padEnd(24)} ${String(count).padStart(4)} req  ` +
        `${rate === null ? '—' : rate.toFixed(1).padStart(6)}/min  ` +
        `limit ${REQUESTS_PER_MINUTE_LIMIT}${over ? '  OVER' : ''}`,
    );
  }
  console.log(
    '  The free tier meters per model. These are NOT to be added together —\n' +
      '  either model can exhaust its own ceiling while the total looks healthy.',
  );

  console.log('\n--- other ---');
  console.log(`echo events (mic heard our own playback): ${r.echoEvents}`);
  console.log(`server rows marked incomplete:            ${r.quotaFailures}`);
  if (r.quotaFailures > 0) {
    console.log(
      '  Expected while one API key serves this load: a turn that runs out of\n' +
        '  quota fails. That is data, not a bug — say so in the report, or a later\n' +
        '  reader will look for a fault that was never there.',
    );
  }
  console.log('');
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const speechIndex = args.indexOf('--speech-ms');
  const speechMs = speechIndex >= 0 ? Number(args[speechIndex + 1]) : null;

  if (files.length === 0) {
    console.error(
      'usage: node benchmarks/realtime/analyze-continuous.mjs <turns.jsonl> ' +
        '[--speech-ms N] [--json]',
    );
    console.error('  --speech-ms comes from: node benchmarks/realtime/vad-reference.mjs <wav>');
    process.exit(2);
  }

  const results = files
    .filter((file) => file !== String(speechMs))
    .map((file) => report(file, speechMs));

  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  results.forEach(print);
}

main();
