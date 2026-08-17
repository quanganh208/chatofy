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

/**
 * Buckets for reading first-audio latency against how long the passage was.
 *
 * The whole streaming-commit feature is the claim that this latency stops
 * depending on passage length. A single p50 over mixed lengths cannot show that
 * — it moves when the mix of fixtures moves — so the answer is read as a
 * fitted line plus these buckets, and the report prints both.
 */
const LENGTH_BUCKETS_MS = [
  [0, 4_000],
  [4_000, 8_000],
  [8_000, 16_000],
  [16_000, 32_000],
  [32_000, Infinity],
];

/**
 * A silent stretch in the output longer than this, while committed text is still
 * waiting to be spoken, counts as a hole the listener hears.
 *
 * Set at the length of an ordinary between-clause breath rather than at a round
 * number: shorter than this and it is prosody, longer and it reads as the
 * translation having stopped.
 */
const CONTINUITY_GAP_MS = 1_500;

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

/**
 * Least-squares fit of first-audio latency against passage length.
 *
 * The INTERCEPT is the headline, not the slope, and that is a correction to an
 * earlier reading of this pipeline. A forced cut closes every turn at
 * `MAX_UTTERANCE_MS` (8s on the extension), so turn-scoped latency is already
 * flat above that ceiling whether or not anything streams — measured against
 * turn length, a broken build and a working one score the same.
 *
 * So `lengthMs` here must be the length of the PASSAGE the fixture contains,
 * supplied with `--passage-ms`, not `speechEndedAt - speechStartedAt`. Against
 * that axis the old path plateaus at roughly the cut plus one pipeline pass, and
 * the streaming path should drop the intercept while staying flat.
 */
function fitLatency(points) {
  if (points.length < 2) return { slope: null, interceptMs: null, n: points.length };
  const meanX = sum(points.map((p) => p.lengthMs)) / points.length;
  const meanY = sum(points.map((p) => p.latencyMs)) / points.length;
  const varianceX = sum(points.map((p) => (p.lengthMs - meanX) ** 2));
  if (varianceX === 0) return { slope: null, interceptMs: Math.round(meanY), n: points.length };
  const slope = sum(points.map((p) => (p.lengthMs - meanX) * (p.latencyMs - meanY))) / varianceX;
  return {
    slope,
    interceptMs: Math.round(meanY - slope * meanX),
    n: points.length,
  };
}

/**
 * First-audio latency per passage, bucketed by passage length.
 *
 * One point per PASSAGE, taken from its first turn: a passage that the gate split
 * into five turns still made the listener wait only once, and counting each turn
 * separately would report that wait five times and flatten the very trend being
 * measured. Passages are told apart by `passageId` when the fixture runner sets
 * one, and otherwise by a gap between turns longer than any within-passage pause.
 */
function firstAudioByPassage(turns, passageMs) {
  const withAudio = turns
    .filter((t) => t.client?.firstAudioPlayedAt && t.client.speechStartedAt)
    .sort((a, b) => a.client.speechStartedAt - b.client.speechStartedAt);

  const passages = [];
  for (const turn of withAudio) {
    const previous = passages.at(-1);
    const samePassage =
      previous &&
      (turn.client.passageId !== undefined
        ? turn.client.passageId === previous.passageId
        : turn.client.speechStartedAt - previous.lastSpeechEndedAt < 2_000);
    if (samePassage) {
      previous.lastSpeechEndedAt = turn.client.speechEndedAt ?? previous.lastSpeechEndedAt;
      previous.turns += 1;
      continue;
    }
    passages.push({
      passageId: turn.client.passageId,
      startedAt: turn.client.speechStartedAt,
      lastSpeechEndedAt: turn.client.speechEndedAt ?? turn.client.speechStartedAt,
      latencyMs: turn.client.firstAudioPlayedAt - turn.client.speechStartedAt,
      turns: 1,
    });
  }

  // Passage length: what the fixture actually contained when known, otherwise
  // what was observed. The supplied value is preferred because a gate that
  // dropped the tail of a passage would otherwise shorten the x-axis by exactly
  // the amount it failed to capture, hiding the failure.
  const points = passages.map((p) => ({
    lengthMs: passageMs ?? p.lastSpeechEndedAt - p.startedAt,
    latencyMs: p.latencyMs,
    turns: p.turns,
  }));

  const buckets = LENGTH_BUCKETS_MS.map(([low, high]) => {
    const inBucket = points.filter((p) => p.lengthMs >= low && p.lengthMs < high);
    return {
      low,
      high,
      passages: inBucket.length,
      p50Ms: percentile(
        inBucket.map((p) => p.latencyMs),
        0.5,
      ),
      p95Ms: percentile(
        inBucket.map((p) => p.latencyMs),
        0.95,
      ),
    };
  }).filter((b) => b.passages > 0);

  return { points, buckets, fit: fitLatency(points) };
}

/**
 * Silence in the output while committed text was still owed to the listener.
 *
 * Distinct from drift, which measures when audio STARTED. This measures whether
 * it kept coming, and it is the metric that catches the translation model's slow
 * tail: a clause that takes nine seconds leaves a hole in the middle of a
 * sentence that no start-time metric can see.
 *
 * Needs the per-clause marks the streaming server records. Absent them it returns
 * nulls rather than zeros — reporting "no gaps" for a run that could not measure
 * gaps would be the most flattering possible lie.
 */
function continuityGaps(turns) {
  const measurable = turns.filter((t) => Array.isArray(t.server?.clauseAudioOffsetsMs));
  if (measurable.length === 0) return { measurable: 0, gaps: null, totalMs: null, worstMs: null };

  let gaps = 0;
  let totalMs = 0;
  let worstMs = 0;
  for (const { server } of measurable) {
    const marks = [...server.clauseAudioOffsetsMs].sort((a, b) => a - b);
    for (let i = 1; i < marks.length; i += 1) {
      const gap = marks[i] - marks[i - 1];
      if (gap <= CONTINUITY_GAP_MS) continue;
      gaps += 1;
      totalMs += gap;
      worstMs = Math.max(worstMs, gap);
    }
  }
  return { measurable: measurable.length, gaps, totalMs, worstMs };
}

/**
 * The longest a speaker went on with nothing committed behind them.
 *
 * This is the failure mode every other metric here scores as a pass. When
 * agreement never stabilises — disfluent speech, a recogniser flip-flopping —
 * nothing is committed at all: no clause is contradicted, no gap is recorded
 * between clauses that do not exist, and the latency percentiles simply lose the
 * passage rather than counting it as slow. What the listener experiences is the
 * translation dying mid-sentence.
 *
 * Measured per turn as the wait from speech starting to the first commit, and
 * from each commit to the next, capped at when the speaker actually stopped.
 */
function commitStarvation(turns) {
  const measurable = turns.filter(
    (t) => Array.isArray(t.server?.commitOffsetsMs) && t.client?.speechStartedAt,
  );
  if (measurable.length === 0) return { measurable: 0, worstMs: null, p95Ms: null, silentTurns: 0 };

  const waits = [];
  let silentTurns = 0;
  for (const turn of measurable) {
    const spokeForMs =
      (turn.client.speechEndedAt ?? turn.client.speechStartedAt) - turn.client.speechStartedAt;
    // Already offsets from the moment the turn opened, so the wait to the first
    // commit is the mark itself — there is no turn-start timestamp on the row to
    // subtract, and an earlier version of this function invented one.
    const marks = [...turn.server.commitOffsetsMs].sort((a, b) => a - b);
    if (marks.length === 0) {
      // Nothing was ever committed: the whole utterance is the wait.
      silentTurns += 1;
      waits.push(spokeForMs);
      continue;
    }
    waits.push(marks[0]);
    for (let i = 1; i < marks.length; i += 1) waits.push(marks[i] - marks[i - 1]);
  }

  return {
    measurable: measurable.length,
    silentTurns,
    p95Ms: percentile(waits, 0.95),
    worstMs: Math.max(...waits),
  };
}

/** Commits the recogniser later disowned. Must be zero; measured, not asserted. */
function contradictedCommits(turns) {
  const measurable = turns.filter((t) => typeof t.server?.commitContradictions === 'number');
  if (measurable.length === 0) return { measurable: 0, count: null };
  return {
    measurable: measurable.length,
    count: sum(measurable.map((t) => t.server.commitContradictions)),
  };
}

function report(path, speechMs, passageMs) {
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
      meanMs: turnLengths.length ? Math.round(sum(turnLengths) / turnLengths.length) : null,
      p95Ms: percentile(turnLengths, 0.95),
      cutForced: clientTurns.filter((t) => t.client.cutForced).length,
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
    firstAudio: firstAudioByPassage(clientTurns, passageMs),
    continuity: continuityGaps(turns),
    starvation: commitStarvation(turns),
    contradicted: contradictedCommits(turns),
    // How many turns actually spoke mid-turn, read off a field the recorder has
    // always written. It exists to tell the two reasons a commit metric is empty
    // apart: nothing streamed, or something streamed and the metric could not
    // see it. Those printed identically once, and the second one reads as a pass.
    streamingTurns: turns.filter((t) => (t.server?.committedClauses ?? 0) > 0).length,
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
  console.log(`mean ${ms(r.turnLength.meanMs)}, p95 ${ms(r.turnLength.p95Ms)}`);
  console.log(`cut at the ceiling: ${r.turnLength.cutForced} of ${r.clientRows}`);

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

  console.log('\n--- first audio vs passage length ---');
  const fit = r.firstAudio.fit;
  if (fit.n < 2) {
    console.log(`  ${fit.n} passage — too few to say anything about the trend`);
  } else if (fit.slope === null) {
    // Every passage the same length, which is what a single `--passage-ms` over
    // one fixture means. That yields an intercept and NO slope, and saying so
    // beats printing a dash that reads like a failed calculation.
    console.log(`  intercept ${ms(fit.interceptMs)}  (${fit.n} passages, all one length)`);
    console.log(
      '  No slope from a single length, by construction. The trend comes from\n' +
        '  running the SHORT and LONG fixtures and comparing their intercepts —\n' +
        '  flat means the long passage does not wait longer than the short one.',
    );
  } else {
    console.log(
      `  intercept ${ms(fit.interceptMs)}   slope ${fit.slope.toFixed(3)}  (${fit.n} passages)`,
    );
    console.log(
      '  The INTERCEPT is the headline. Slope near 0 with a HIGH intercept is not\n' +
        '  success — it is what an 8s forced cut produces on its own, streaming or\n' +
        '  not. Read the two together, and against the baseline run.',
    );
  }
  for (const b of r.firstAudio.buckets) {
    const label = `${b.low / 1000}-${b.high === Infinity ? '∞' : b.high / 1000}s`;
    console.log(
      `  ${label.padEnd(9)} ${String(b.passages).padStart(3)} passages  ` +
        `p50 ${ms(b.p50Ms)}  p95 ${ms(b.p95Ms)}`,
    );
  }

  console.log('\n--- streaming commits ---');
  // An empty commit metric on a run that DID stream is a broken measurement, not
  // a clean result, and the difference has to be shouted rather than inferred:
  // every line below prints a dash in both cases, and a dash beside "no streaming
  // turns" is the most reassuring thing this tool can say when it is blind.
  const blind = (what) =>
    r.streamingTurns > 0
      ? `  ${what}BROKEN — ${r.streamingTurns} turns committed clauses but the field is missing.\n` +
        '                        Do NOT read this run as a pass. Re-record with a build that writes it.'
      : `  ${what}— not recorded (no streaming turns in this run)`;
  if (r.contradicted.measurable === 0) {
    console.log(blind('contradicted commits: '));
  } else {
    const bad = r.contradicted.count;
    console.log(
      `  contradicted commits: ${bad} over ${r.contradicted.measurable} turns` +
        `${bad > 0 ? '   MUST BE ZERO — words were spoken and then disowned' : ''}`,
    );
  }
  if (r.continuity.measurable === 0) {
    console.log(blind('continuity gaps:      '));
  } else {
    console.log(
      `  continuity gaps:      ${r.continuity.gaps} over ${r.continuity.measurable} turns, ` +
        `worst ${ms(r.continuity.worstMs)}, total ${ms(r.continuity.totalMs)}`,
    );
  }
  if (r.starvation.measurable === 0) {
    console.log(blind('commit starvation:    '));
  } else {
    console.log(
      `  commit starvation:    p95 ${ms(r.starvation.p95Ms)}, worst ${ms(r.starvation.worstMs)}` +
        `${r.starvation.silentTurns ? `, ${r.starvation.silentTurns} turns committed NOTHING` : ''}`,
    );
    console.log(
      '  Starvation is the failure every other number here scores as a pass: with\n' +
        '  nothing committed, nothing can be contradicted and no gap exists between\n' +
        '  clauses that were never spoken.',
    );
  }

  console.log('\n--- other ---');
  console.log(`echo events (mic heard our own playback): ${r.echoEvents}`);
  const dropped = r.outcomes.dropped ?? 0;
  if (dropped > 0) {
    console.log(
      `dropped turns: ${dropped}  — on a streaming turn this silences the REST of\n` +
        '  the passage, not just one short utterance. Report the seconds lost.',
    );
  }
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
  const speechIndex = args.indexOf('--speech-ms');
  const speechMs = speechIndex >= 0 ? Number(args[speechIndex + 1]) : null;
  const passageIndex = args.indexOf('--passage-ms');
  const passageMs = passageIndex >= 0 ? Number(args[passageIndex + 1]) : null;
  // Filtered against the flag VALUES, not just the `--` prefix: a bare number
  // following a flag would otherwise be read as a second input file.
  const flagValues = new Set([String(speechMs), String(passageMs)]);
  const files = args.filter((a) => !a.startsWith('--') && !flagValues.has(a));

  if (files.length === 0) {
    console.error(
      'usage: node benchmarks/realtime/analyze-continuous.mjs <turns.jsonl> ' +
        '[--speech-ms N] [--passage-ms N] [--json]',
    );
    console.error('  --speech-ms  coverage denominator, from vad-reference.mjs <wav>');
    console.error(
      '  --passage-ms length of the passage each fixture contains. Without it the\n' +
        '               first-audio fit uses observed turn spans, which the forced cut\n' +
        '               caps at MAX_UTTERANCE_MS — flattening the trend being measured.',
    );
    process.exit(2);
  }

  const results = files.map((file) => report(file, speechMs, passageMs));

  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  results.forEach(print);
}

main();
