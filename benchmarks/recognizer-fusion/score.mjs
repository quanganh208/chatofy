// Recognizer fusion ruler: the shipped prompt, model and guard over real
// Vietnamese conversations, scored against a reference transcript.
//
//   pnpm --filter @chatofy/ai-providers build   # loads the built package, not src/
//   node benchmarks/recognizer-fusion/score.mjs [--repeats 3] [--with-homophones]
//
// Reads data/conversations.json ([{id, turns, alternates, reference}]), which is
// gitignored: the turns are personal data. See README.md for how it is built.
//
// `--with-homophones` also runs the homophone repair on each turn and merges
// the two as the API does (`mergeCorrections`, the fusion's first), so the
// number is what the display line shows.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptHomophoneRepairs,
  acceptRecognizerFusion,
  applyTranscriptCorrections,
  mergeCorrections,
  OpenAiCompatibleLoanwordRespeller,
  wordsOf,
} from '../../packages/ai-providers/dist/index.js';
import { PRESETS, readApiKey } from '../translation-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repeatsAt = args.indexOf('--repeats');
const repeats = repeatsAt >= 0 ? Number(args[repeatsAt + 1]) : 1;
const withHomophones = args.includes('--with-homophones');

/** Turns read before the one corrected, as the API sends them. */
const BEFORE = 2;

const conversations = JSON.parse(readFileSync(resolve(HERE, 'data/conversations.json'), 'utf8'));
const preset = PRESETS.deepseek;
const checker = new OpenAiCompatibleLoanwordRespeller({
  apiKey: readApiKey(preset.apiKeyEnv),
  baseUrl: preset.baseUrl,
  model: preset.models[0],
  name: 'deepseek',
  extraBody: preset.extraBody,
});

/** Word-level edit distance. */
function edits(reference, hypothesis) {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length];
}

const latencies = [];
let calls = 0;

/** A check's answer, or `fallback` when the host failed; timed. */
async function timed(label, run, fallback) {
  const started = Date.now();
  try {
    return await run();
  } catch (err) {
    console.error(`  ${label}: ${err.message}`);
    return fallback;
  } finally {
    latencies.push(Date.now() - started);
  }
}

/** Each turn with its accepted corrections applied, plus a log of them. */
async function correctAll(conversation) {
  const label = conversation.id.slice(0, 4);
  const log = [];
  const corrected = await Promise.all(
    conversation.turns.map(async (transcript, index) => {
      if (!transcript.trim()) return transcript;
      const before = conversation.turns.slice(Math.max(0, index - BEFORE), index);
      // As the API does: an alternate that heard the same words costs no call.
      const differing = [conversation.alternates[index] ?? ''].filter(
        (alternate) => wordsOf(alternate).join(' ') !== wordsOf(transcript).join(' '),
      );
      const [fused, repaired] = await Promise.all([
        differing.length === 0
          ? []
          : timed(
              `${label}#${index} fusion`,
              async () => {
                calls++;
                return acceptRecognizerFusion(
                  transcript,
                  differing,
                  await checker.fuseRecognizers({ transcript, alternates: differing, before }),
                );
              },
              [],
            ),
        !withHomophones
          ? []
          : timed(
              `${label}#${index} homophones`,
              async () =>
                acceptHomophoneRepairs(
                  transcript,
                  await checker.repairHomophones({ transcript, before }),
                ),
              [],
            ),
      ]);
      const corrections = mergeCorrections(fused, repaired);
      for (const correction of corrections)
        log.push(`${label}#${index} ${correction.heard} -> ${correction.said}`);
      return applyTranscriptCorrections(transcript, corrections);
    }),
  );
  return { corrected, log };
}

const runs = [];
for (let run = 1; run <= repeats; run++) {
  let referenceWords = 0;
  let before = 0;
  let after = 0;
  const accepted = [];
  const perConversation = [];
  for (const conversation of conversations) {
    const reference = wordsOf(conversation.reference);
    const { corrected, log } = await correctAll(conversation);
    const was = edits(reference, wordsOf(conversation.turns.join(' ')));
    const now = edits(reference, wordsOf(corrected.join(' ')));
    referenceWords += reference.length;
    before += was;
    after += now;
    accepted.push(...log);
    perConversation.push(`${conversation.id.slice(0, 4)} ${was}->${now}`);
  }
  const pct = (count) => `${((100 * count) / referenceWords).toFixed(2)}%`;
  console.log(
    `run ${run}/${repeats}: WER ${pct(before)} -> ${pct(after)} over ${referenceWords} words` +
      ` (${perConversation.join(', ')})`,
  );
  for (const line of accepted.sort()) console.log(`  accepted  ${line}`);
  runs.push({ before, after, accepted: accepted.length });
}

const sorted = [...latencies].sort((a, b) => a - b);
const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
console.log(
  `\n${runs.length} run(s), mode ${withHomophones ? 'fusion + homophones' : 'fusion'}: ` +
    runs.map((r) => `${r.before}->${r.after} errors, ${r.accepted} accepted`).join('; '),
);
console.log(
  `fusion calls ${calls}; check latency p50 ${at(0.5)} ms, p90 ${at(0.9)} ms over ${sorted.length}`,
);
