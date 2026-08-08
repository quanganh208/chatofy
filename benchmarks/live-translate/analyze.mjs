// Turn the run's rows into the table the chapter prints.
//
// Two rules the output enforces rather than leaves to whoever reads it:
//
//   STRATIFY BY UTTERANCE LENGTH. The spike measured +240ms on a 3.1s clip and
//     −2961ms on a 6.6s one — the continuous model starts translating mid
//     utterance, so its advantage grows with length. An unstratified mean lets
//     the fixture mix decide the winner, which means whoever chose the fixtures
//     chose the result.
//   COUNT WHAT WAS EXCLUDED. Error and quota rows are dropped from the
//     percentiles and reported as their own per-arm number. A latency table
//     built from successes alone cannot tell "no failures" from "failures not
//     written down" — the same argument `TurnMetrics.completed` already makes.
//
// Usage:
//   node benchmarks/live-translate/analyze.mjs results/<stamp>/rows.jsonl
//   node benchmarks/live-translate/analyze.mjs results/<stamp>/rows.jsonl --json

import { readFileSync } from 'node:fs';

/** Length bands, in ms of speech. Chosen to split the 3–10s fixture range evenly. */
const BANDS = [
  { label: '3-5s', min: 0, max: 5000 },
  { label: '5-7s', min: 5000, max: 7000 },
  { label: '7-10s', min: 7000, max: Infinity },
];

const ARMS = ['cascade', 'live'];

/**
 * Nearest-rank percentile.
 *
 * Not interpolated: with n around 50 per cell, interpolation invents a value
 * between two measurements and the reader cannot point at the utterance it came
 * from. Nearest-rank always names a real run.
 */
function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

function summarize(rows) {
  const usable = rows.filter((r) => !r.error && r.firstAudioAfterSpeechEndMs !== null);
  const latencies = usable.map((r) => r.firstAudioAfterSpeechEndMs);
  return {
    n: usable.length,
    excluded: rows.length - usable.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    min: latencies.length ? Math.min(...latencies) : null,
    max: latencies.length ? Math.max(...latencies) : null,
  };
}

function pad(value, width) {
  return String(value ?? '—').padStart(width);
}

function main() {
  const [path, ...flags] = process.argv.slice(2);
  if (!path) {
    console.error('usage: node analyze.mjs <rows.jsonl> [--json]');
    process.exit(2);
  }
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const report = { source: path, directions: {}, reliability: {}, models: {} };

  for (const arm of ARMS) {
    const armRows = rows.filter((r) => r.arm === arm);
    report.reliability[arm] = {
      attempted: armRows.length,
      errored: armRows.filter((r) => r.error).length,
      noAudio: armRows.filter((r) => !r.error && r.firstAudioAfterSpeechEndMs === null).length,
    };
    report.models[arm] = [...new Set(armRows.map((r) => r.model))];
  }

  // Wrong-language output is a live-only robustness finding and never shares a
  // column with latency; the cascade is told its direction and cannot get it
  // wrong.
  const liveRows = rows.filter((r) => r.arm === 'live');
  report.reliability.live.wrongLanguage = liveRows.filter(
    (r) => r.detectedLangs?.length && !r.detectedLangs.includes(r.lang),
  ).length;

  /**
   * Utterances the model answered with words but no speech.
   *
   * Its own category, not an error and not a latency row. Measured on this run:
   * the end-to-end model REFUSED to translate a line of 19th-century fiction
   * ("the young man is in bondage and much I fear his death is decreed"),
   * returning "I'm just a language model and can't help with that" — in English,
   * when the target language was Vietnamese — and zero audio. The cascade
   * translated the same line without comment.
   *
   * That is a property of putting a general-purpose model in a translator's
   * seat: it can decline. A user hears silence and is told nothing. No latency
   * figure can show it, so it gets counted here.
   */
  for (const arm of ARMS) {
    report.reliability[arm].silentWithText = rows.filter(
      (r) => r.arm === arm && !r.error && r.outputBytes === 0 && r.transcript.trim().length > 0,
    ).length;
  }

  for (const direction of ['vi_to_en', 'en_to_vi']) {
    const inDirection = rows.filter((r) => r.direction === direction);
    report.directions[direction] = { overall: {}, bands: {} };
    for (const arm of ARMS) {
      report.directions[direction].overall[arm] = summarize(
        inDirection.filter((r) => r.arm === arm),
      );
    }
    for (const band of BANDS) {
      const inBand = inDirection.filter((r) => r.speechMs >= band.min && r.speechMs < band.max);
      report.directions[direction].bands[band.label] = Object.fromEntries(
        ARMS.map((arm) => [arm, summarize(inBand.filter((r) => r.arm === arm))]),
      );
    }
  }

  if (flags.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const dates = [...new Set(rows.map((r) => r.at?.slice(0, 10)))].filter(Boolean);
  console.log(`\nFirst translated audio, ms after the VAD end of speech`);
  console.log(`Run dates: ${dates.join(', ')}`);
  console.log(
    'Cascade arm is emulated conservatively: endpoint at VAD end + 500ms hangover,\n' +
      'no speculation. Its real latency is therefore AT MOST what is shown.\n',
  );

  for (const [direction, data] of Object.entries(report.directions)) {
    console.log(`── ${direction} ${'─'.repeat(46)}`);
    console.log('  band     arm       n   excl     p50     p95     min     max');
    for (const [label, arms] of [['overall', data.overall], ...Object.entries(data.bands)]) {
      for (const arm of ARMS) {
        const s = arms[arm];
        if (!s || s.n + s.excluded === 0) continue;
        console.log(
          `  ${label.padEnd(8)} ${arm.padEnd(8)} ${pad(s.n, 3)} ${pad(s.excluded, 4)} ` +
            `${pad(s.p50, 7)} ${pad(s.p95, 7)} ${pad(s.min, 7)} ${pad(s.max, 7)}`,
        );
      }
    }
    console.log('');
  }

  console.log('── reliability (excluded from every percentile above) ──────────');
  for (const arm of ARMS) {
    const r = report.reliability[arm];
    console.log(
      `  ${arm.padEnd(8)} attempted=${r.attempted} errored=${r.errored} noAudio=${r.noAudio}` +
        ` silentWithText=${r.silentWithText}` +
        (arm === 'live' ? ` wrongLanguage=${r.wrongLanguage}` : ''),
    );
  }
  const refusals = rows.filter(
    (r) => !r.error && r.outputBytes === 0 && r.transcript.trim().length > 0,
  );
  if (refusals.length > 0) {
    console.log('\n  answered in words but said nothing aloud:');
    for (const r of refusals) {
      console.log(`    ${r.arm} ${r.id} — ${JSON.stringify(r.transcript.slice(0, 90))}`);
    }
  }
  console.log(`\n  models: ${JSON.stringify(report.models)}`);
  console.log(
    '\nAdequacy and naturalness are NOT in this table. Adequacy needs an ASR\n' +
      'that sits in neither arm (see score-adequacy.py); naturalness needs the\n' +
      'listening panel. Latency alone is a defensible chapter; latency presented\n' +
      'as quality is not.\n',
  );
}

main();
