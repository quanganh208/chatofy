// Did a cheaper arm translate the same inputs the baseline did?
//
//   node benchmarks/call-budget/compare-answer-prompts.mjs \
//     --baseline win-baseline-1.log,win-baseline-2.log,win-baseline-3.log \
//     --arm win-arm-cut-1.log,win-arm-cut-2.log,win-arm-cut-3.log
//
// The cost knobs change WHEN a turn guesses and how often its live preview is
// redone. They do not change the prompt or the model of the translation a
// listener is given: that prompt is the turn's transcript, its context and its
// hints, sent to the same model whichever lane sends it. So the answer a turn
// gets is either a prompt the baseline also sent or a different one, and that
// is countable from the `h=` hash every `llm` line carries, with no paid call
// and no reference translation.
//
// "Answer lanes" are `final` and `speculation`, because an adopted guess IS the
// turn's answer; `block` is reported separately. A prompt the baseline never
// sent means the arm translated a different input, which is where a quality
// difference could come from. The recognizer is local and deterministic enough
// that the baseline's own runs agree with each other on most prompts; that
// agreement is printed too, as the noise floor to read the arm against.
//
// Reads files, writes Markdown to stdout, never writes to disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseLlmLine } from './analyze.mjs';

const ANSI = /\x1b\[[0-9;]*m/g;

/** Hashes per lane in one log file. */
export function promptsByLane(text) {
  const lanes = new Map();
  for (const raw of text.split('\n')) {
    const call = parseLlmLine(raw.replace(ANSI, ''));
    if (!call || call.kind !== 'translate' || !call.ok) continue;
    const lane = call.purpose ?? '-';
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(call.h);
  }
  return lanes;
}

const ANSWER_LANES = ['final', 'speculation'];

/** The share of `hashes` that `known` contains, counted per occurrence. */
function covered(hashes, known) {
  if (hashes.length === 0) return { hit: 0, total: 0 };
  return { hit: hashes.filter((h) => known.has(h)).length, total: hashes.length };
}

const pct = ({ hit, total }) =>
  total ? `${((100 * hit) / total).toFixed(1)}% (${hit}/${total})` : 'n/a';

/** Every number the report prints. */
export function compare(baselineTexts, armTexts) {
  const answerSet = (texts) => {
    const set = new Set();
    for (const text of texts) {
      const lanes = promptsByLane(text);
      for (const lane of ANSWER_LANES) for (const h of lanes.get(lane) ?? []) set.add(h);
    }
    return set;
  };
  const finalsOf = (text) => promptsByLane(text).get('final') ?? [];
  const blocksOf = (text) => promptsByLane(text).get('block') ?? [];
  const blockSet = (texts) => new Set(texts.flatMap(blocksOf));

  const baselineAnswers = answerSet(baselineTexts);
  // Noise floor: each baseline run against the other baseline runs.
  const floor = baselineTexts.map((text, i) =>
    covered(finalsOf(text), answerSet(baselineTexts.filter((_, j) => j !== i))),
  );
  const arm = armTexts.map((text) => covered(finalsOf(text), baselineAnswers));
  const armBlocks = armTexts.map((text) => covered(blocksOf(text), blockSet(baselineTexts)));
  const floorBlocks = baselineTexts.map((text, i) =>
    covered(blocksOf(text), blockSet(baselineTexts.filter((_, j) => j !== i))),
  );
  return { floor, arm, armBlocks, floorBlocks };
}

export function render(result) {
  const lines = [
    '# Answer prompts: arm against baseline',
    '',
    'Share of `final` translations whose prompt the baseline also sent as a final or as a guess:',
    '',
    '| run | final prompts seen in baseline | block prompts seen in baseline |',
    '|---|---|---|',
  ];
  result.floor.forEach((value, i) =>
    lines.push(
      `| baseline-${i + 1} vs other baselines (noise floor) | ${pct(value)} | ${pct(result.floorBlocks[i])} |`,
    ),
  );
  result.arm.forEach((value, i) =>
    lines.push(`| arm-${i + 1} vs all baselines | ${pct(value)} | ${pct(result.armBlocks[i])} |`),
  );
  lines.push('');
  return lines.join('\n');
}

function filesFrom(argv, flag) {
  const at = argv.indexOf(flag);
  if (at < 0 || !argv[at + 1]) throw new Error(`${flag} <file,file,…> is required`);
  return argv[at + 1].split(',').map((path) => readFileSync(path, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.stdout.write(render(compare(filesFrom(argv, '--baseline'), filesFrom(argv, '--arm'))));
}
