// Homophone repair ruler: the shipped prompt, model and guard over real
// Vietnamese conversations, scored against a reference transcript.
//
//   pnpm --filter @chatofy/ai-providers build   # loads the built package, not src/
//   node benchmarks/homophone-repair/score.mjs [--repeats 3]
//
// Reads data/conversations.json ([{id, turns: [transcript], reference}]), which
// is gitignored: the turns are personal data. See README.md for how it is built.
//
// Two numbers, because one can be gamed by the other:
// - WER of the turns before and after the repairs the guard accepted;
// - false repairs: the same model and guard run over the REFERENCE itself, cut
//   into turn-sized chunks. The reference is already right, so every accepted
//   repair there is a word changed that should not have been.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptHomophoneRepairs,
  applyTranscriptCorrections,
  OpenAiCompatibleLoanwordRespeller,
} from '../../packages/ai-providers/dist/index.js';
import { respellerHostFromArgs } from '../translation-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repeatsAt = args.indexOf('--repeats');
const repeats = repeatsAt >= 0 ? Number(args[repeatsAt + 1]) : 1;

/** Turns read before the one repaired, as the API sends them. */
const BEFORE = 2;
/** Words per reference chunk, closed at the next sentence end. */
const CHUNK_WORDS = 18;

const conversations = JSON.parse(readFileSync(resolve(HERE, 'data/conversations.json'), 'utf8'));
// The production host unless `--provider`/`--base-url`/`--model` say otherwise.
const host = respellerHostFromArgs(args);
const checker = new OpenAiCompatibleLoanwordRespeller(host);

const words = (text) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

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

/** The reference cut into turn-sized chunks, each ending a sentence. */
function chunks(reference) {
  const out = [];
  let current = [];
  for (const word of reference.split(/\s+/).filter(Boolean)) {
    current.push(word);
    if (current.length >= CHUNK_WORDS && /[.?!]$/.test(word)) {
      out.push(words(current.join(' ')).join(' '));
      current = [];
    }
  }
  if (current.length) out.push(words(current.join(' ')).join(' '));
  return out;
}

/** Each turn with its accepted repairs applied, plus a log of what was accepted. */
const latencies = [];

async function repairAll(turns, label) {
  const log = [];
  const repaired = await Promise.all(
    turns.map(async (transcript, index) => {
      if (!transcript.trim()) return transcript;
      const started = Date.now();
      const proposals = await checker
        .repairHomophones({
          transcript,
          before: turns.slice(Math.max(0, index - BEFORE), index),
        })
        .catch((err) => {
          console.error(`  ${label}#${index}: ${err.message}`);
          return [];
        });
      latencies.push(Date.now() - started);
      const accepted = acceptHomophoneRepairs(transcript, proposals);
      for (const repair of accepted)
        log.push(`${label}#${index} ${repair.heard} -> ${repair.said}`);
      return applyTranscriptCorrections(transcript, accepted);
    }),
  );
  return { repaired, log };
}

const runs = [];
for (let run = 1; run <= repeats; run++) {
  let referenceWords = 0;
  let before = 0;
  let after = 0;
  const accepted = [];
  const falseRepairs = [];
  for (const conversation of conversations) {
    const reference = words(conversation.reference);
    const { repaired, log } = await repairAll(conversation.turns, conversation.id.slice(0, 4));
    referenceWords += reference.length;
    before += edits(reference, words(conversation.turns.join(' ')));
    after += edits(reference, words(repaired.join(' ')));
    accepted.push(...log);
    const negative = await repairAll(
      chunks(conversation.reference),
      `${conversation.id.slice(0, 4)}-ref`,
    );
    falseRepairs.push(...negative.log);
  }
  const pct = (count) => `${((100 * count) / referenceWords).toFixed(2)}%`;
  console.log(
    `run ${run}/${repeats}: WER ${pct(before)} -> ${pct(after)} over ${referenceWords} words`,
  );
  for (const line of accepted.sort()) console.log(`  accepted  ${line}`);
  for (const line of falseRepairs.sort()) console.log(`  on-reference  ${line}`);
  runs.push({ before, after, accepted: accepted.length, falseRepairs: falseRepairs.length });
}
if (repeats > 1) console.log(JSON.stringify(runs));
// Every call of a run is in flight at once, as many turns' are on the host, so
// this is the latency under that load rather than one quiet call's.
latencies.sort((a, b) => a - b);
const at = (q) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
console.log(
  `latency over ${latencies.length} calls: p50 ${at(0.5)} ms, p90 ${at(0.9)} ms, max ${at(1)} ms`,
);
