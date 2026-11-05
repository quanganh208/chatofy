// Read a meeting run and print the gates its numbers decide.
//
//   node benchmarks/conference/analyze.mjs --run <run-tag>
//
// Lags are measured in the harness's one process:
//   subtitle: the listener's first non-empty line, from the server's turn start;
//   audio: the listener's first frame, from the client closing the turn. That is
//   the closest thing to "speech ended" the client has; on a hangover cut it
//   sits a hangover after the last word.
// A turn the speech gate opened on nothing ends with a non-speech reason and
// is not a lost turn; one that ended any other way with no final is.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Reasons that mean "nothing was said", so no words were lost. */
export const NOTHING_SAID = new Set(['no_speech', 'empty', 'empty_transcript', 'no_transcript']);

/** Nearest-rank percentile; null on an empty list. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function isLost(turn) {
  return turn.finalMs === null && !NOTHING_SAID.has(turn.endReason);
}

const lag = (turns, end, start) =>
  turns
    .filter((turn) => turn[end] !== null && turn[start] !== null)
    .map((turn) => turn[end] - turn[start]);

const round = (value) => (value === null ? null : Math.round(value * 1000) / 1000);

function group(turns) {
  const finals = turns.filter((turn) => turn.finalMs !== null);
  const lost = turns.filter(isLost).length;
  const delivered = finals.filter((turn) => turn.listenerFinalMs !== null).length;
  const subtitle = lag(turns, 'firstSubtitleMs', 'readyMs');
  const audio = lag(turns, 'firstAudioMs', 'endSentMs').filter((value) => value >= 0);
  const polish = lag(turns, 'polishedMs', 'finalMs');
  const voiced = finals.filter((turn) => turn.audioFrames > 0);
  return {
    turns: turns.length,
    finals: finals.length,
    lost,
    lossRate: round(finals.length + lost === 0 ? null : lost / (finals.length + lost)),
    finalDeliveryRate: round(finals.length === 0 ? null : delivered / finals.length),
    subtitleLagP50: percentile(subtitle, 50),
    subtitleLagP95: percentile(subtitle, 95),
    audioLagP50: percentile(audio, 50),
    audioLagP95: percentile(audio, 95),
    voicedRate: round(finals.length === 0 ? null : voiced.length / finals.length),
    audioFrameDeliveryRate: round(
      voiced.length === 0
        ? null
        : voiced.reduce((sum, turn) => sum + turn.audioFramesDelivered, 0) /
            voiced.reduce((sum, turn) => sum + turn.audioFrames, 0),
    ),
    polished: polish.length,
    polishDelayP50: percentile(polish, 50),
  };
}

export function summarize(turns) {
  const bySpeaker = {};
  for (const name of new Set(turns.map((turn) => turn.speaker))) {
    bySpeaker[name] = group(turns.filter((turn) => turn.speaker === name));
  }
  return { overall: group(turns), bySpeaker };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--run');
  if (flag === -1 || !process.argv[flag + 1]) throw new Error('--run <run-tag> is required');
  const dir = join(HERE, 'results', process.argv[flag + 1]);
  const turns = readFileSync(join(dir, 'turns.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const summary = {
    ...summarize(turns),
    arm: run.arm,
    pair: run.pair,
    aborted: run.aborted,
    refusals: run.refusals,
    relayErrors: run.relayErrors,
    unmatchedAudio: run.unmatchedAudio,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.table({ overall: summary.overall, ...summary.bySpeaker });
  console.log(
    JSON.stringify({
      refusals: run.refusals,
      relayErrors: run.relayErrors,
      unmatchedAudio: run.unmatchedAudio,
    }),
  );
}
