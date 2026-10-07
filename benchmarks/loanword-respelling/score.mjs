// Loanword respelling ruler: the shipped detector, prompt and guards over real
// Vietnamese turns, scored against a hand-adjudicated answer for every span.
//
//   pnpm --filter @chatofy/ai-providers build   # loads the built package, not src/
//   node benchmarks/loanword-respelling/score.mjs [--repeats 3]
//
// Reads data/turns.json ([{id, src, en}]) and data/truth.json
// ({"<span lowercased>": "<intended spelling>" | null}). Both are gitignored:
// the turns are personal data. A span missing from truth.json is reported as
// "unjudged" and counts neither way. See README.md for how to dump the turns.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptRespellings,
  foreignSpans,
  OpenAiCompatibleLoanwordRespeller,
  respellingKey,
  unresolvedSpans,
} from '../../packages/ai-providers/dist/index.js';
import { PRESETS, readApiKey } from '../translation-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repeatsAt = args.indexOf('--repeats');
const repeats = repeatsAt >= 0 ? Number(args[repeatsAt + 1]) : 1;

const turns = JSON.parse(readFileSync(resolve(HERE, 'data/turns.json'), 'utf8'));
const truth = JSON.parse(readFileSync(resolve(HERE, 'data/truth.json'), 'utf8'));
const preset = PRESETS.deepseek;
const respeller = new OpenAiCompatibleLoanwordRespeller({
  apiKey: readApiKey(preset.apiKeyEnv),
  baseUrl: preset.baseUrl,
  model: preset.models[0],
  name: 'deepseek',
  extraBody: preset.extraBody,
});

const letters = (text) => (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const totals = [];

for (let run = 1; run <= repeats; run++) {
  const tally = { right: 0, wrong: 0, kept: 0, missed: 0, unjudged: 0, calls: 0 };
  const rows = [];
  for (const turn of turns) {
    const translations = { en: turn.en ?? '' };
    const spans = unresolvedSpans(foreignSpans(turn.src), translations);
    let accepted = {};
    if (spans.length > 0) {
      tally.calls += 1;
      const proposals = await respeller
        .respell({
          transcript: turn.src,
          translation: turn.en ?? '',
          spans: spans.map((span) => span.text),
        })
        .catch((err) => {
          console.error(`  ${turn.id}: ${err.message}`);
          return {};
        });
      accepted = acceptRespellings(spans, proposals, translations);
      await new Promise((done) => setTimeout(done, preset.gapMs ?? 200));
    }
    for (const span of spans) {
      const key = respellingKey(span.text);
      const got = accepted[key];
      if (!(key in truth)) {
        tally.unjudged += 1;
        rows.push(['unjudged', span.text, got ?? '-']);
        continue;
      }
      const want = truth[key];
      if (got === undefined) {
        // Nothing changed: right when the span was already right, a miss otherwise.
        if (want === null) tally.kept += 1;
        else tally.missed += 1;
        rows.push([want === null ? 'kept' : 'missed', span.text, '-', want ?? '']);
      } else if (want !== null && letters(got) === letters(want)) {
        tally.right += 1;
        rows.push(['right', span.text, got]);
      } else {
        tally.wrong += 1;
        rows.push(['WRONG', span.text, got, want ?? '(keep)']);
      }
    }
  }
  console.log(`run ${run}/${repeats}`);
  for (const row of rows) console.log(`  ${row.join('\t')}`);
  console.log(`  ${JSON.stringify(tally)}`);
  totals.push(tally);
}

if (repeats > 1) {
  const sum = (field) => totals.reduce((total, tally) => total + tally[field], 0);
  console.log(
    `over ${repeats} runs: right=${sum('right')} wrong=${sum('wrong')} ` +
      `kept=${sum('kept')} missed=${sum('missed')}`,
  );
}
