// Does the translation model actually CONTINUE, or does it quietly rewrite what
// has already been spoken?
//
// The streaming design translates one committed clause at a time and plays each
// immediately. Clause N+1's request therefore carries what clause N already said
// aloud, and asks the model to carry on from there. That only works if the model
// obeys. If it re-translates the whole sentence instead, the listener hears the
// opening of the sentence a second time, in slightly different words — and there
// is no way to take the first version back.
//
// This is the single riskiest assumption in the server work, and it costs about
// ten requests to settle, so it is settled BEFORE any session code is written
// rather than discovered afterwards.
//
// Usage:
//   set -a; . apps/api/.env; set +a
//   node benchmarks/realtime/gemini-continuation-probe.mjs
//   node benchmarks/realtime/gemini-continuation-probe.mjs --json
//
// Costs real quota against the free tier's per-day ceiling. Run it once.
//
// KNOWN, MEASURED, AND NOT FIXED HERE — the punctuation seam. A non-final clause
// whose source ends in a comma can still come back ending in a full stop
// ("...tôi nghĩ là được," -> "...I think it's fine."), and the next continuation
// then opens lowercase: "it's fine. but the cost is a bit high,". On screen that
// is untidy. Through TTS it is worse, because the engine takes its intonation
// from the punctuation it is given (see `audio/clause-splitter.ts`) and a full
// stop tells it to close the sentence — so the listener hears the utterance end
// and then restart. Whoever builds the commit driver has to decide where this is
// handled: in the prompt, or by normalizing terminal punctuation on non-final
// clauses before synthesis. It is recorded here rather than silently patched
// because it changes what a clause sounds like, not just how it reads.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Every model a committed clause could actually be translated by.
 *
 * Swept rather than testing the leader alone, and the reason is the ladder
 * itself: `session/translation-model-policy.ts` walks down on a quota rejection,
 * so the model serving a commit is whichever one had quota at that moment — not
 * whichever one was measured. A model that rewrites already-spoken text would
 * break the no-retraction invariant exactly when the leader is throttled, which
 * is the busiest moment and the worst time to find out.
 *
 * Sweeping also spreads the probe's own cost: the free tier meters per model as
 * well as per project, so three models is three separate per-minute ceilings.
 */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];

/**
 * Sentences split at the clause boundaries the commit policy would find.
 *
 * Chosen for the shapes that tempt a model to reach backwards: a trailing time
 * phrase that changes how the opening should read, a subordinate clause arriving
 * late, and a list that only resolves at its end. A sentence whose parts are
 * independent would pass this test without proving anything.
 */
const CASES = [
  {
    lang: 'vi',
    clauses: [
      'Xin chào, hôm nay tôi muốn đặt một bàn cho hai người,',
      'vào lúc bảy giờ tối,',
      'gần cửa sổ nếu còn chỗ.',
    ],
  },
  {
    lang: 'vi',
    clauses: [
      'Về cái đề xuất hôm qua thì tôi nghĩ là được,',
      'nhưng mà chi phí hơi cao,',
      'nên mình cần bàn lại với bên kỹ thuật.',
    ],
  },
  {
    lang: 'en',
    clauses: [
      'So about the deployment yesterday,',
      'it mostly went fine,',
      'except the database migration had to be rolled back.',
    ],
  },
];

const target = (lang) => (lang === 'vi' ? 'English' : 'Vietnamese');
const source = (lang) => (lang === 'vi' ? 'Vietnamese' : 'English');

/**
 * The append-only prompt this probe is testing.
 *
 * Kept here as the single wording under test so the server can adopt exactly what
 * measured well, rather than a paraphrase of it.
 */
function continuationPrompt(lang, spokenTarget, newClause) {
  return [
    `You are translating ${source(lang)} speech into ${target(lang)} live, while the speaker is still talking.`,
    '',
    'Already spoken aloud to the listener (CANNOT be changed or repeated):',
    spokenTarget,
    '',
    `Next ${source(lang)} clause:`,
    newClause,
    '',
    'Translate ONLY the next clause, as a continuation of what was already spoken.',
    'Do not repeat, restate, or correct any part of what was already spoken.',
    // Added after measurement, not from theory. Without this line the model
    // invented a contrastive connective — "it mostly went fine" came back as
    // "NHƯNG nhìn chung là ổn" ("BUT overall it's fine") — because it is trying
    // to bridge a clause whose surroundings it cannot see. The overlap check
    // scores that a clean pass: nothing was repeated. A listener hears a
    // sentence that contradicts itself.
    'Do not add linking words (but, so, and, however) that are not in the clause itself.',
    'Output only the continuation text.',
  ].join('\n');
}

const firstPrompt = (lang, clause) =>
  `Translate this ${source(lang)} speech into ${target(lang)}. Output only the translation.\n\n${clause}`;

/**
 * Send one request, moving to the next key when a key is out of quota.
 *
 * `GEMINI_API_KEY` holds a comma-separated pool, and the free tier meters per
 * PROJECT — so keys from different projects multiply the ceiling, exactly as the
 * provider in `packages/ai-providers` uses them. An earlier version of this
 * script took `split(',')[0]` and spent one key while the rest of the pool sat
 * idle; it hit 429 after eighteen requests and looked like a hard daily ceiling
 * when it was one key's per-minute one.
 *
 * Rotation starts where the last call left off rather than restarting at the
 * first key, so load spreads instead of always hammering key one.
 */
let nextKeyIndex = 0;

async function generate(keys, prompt, model) {
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const key = keys[nextKeyIndex % keys.length];
    nextKeyIndex += 1;

    const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (res.status === 429) {
      // Never logged with the key attached: this output gets pasted into reports.
      lastError = `quota exhausted on ${keys.length} key(s)`;
      continue;
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  }

  throw new Error(
    `${lastError}. Every key is rate-limited right now — wait for the per-minute ` +
      'window, or add a key from a different Google Cloud project.',
  );
}

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:…"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Did the continuation reach back into what was already spoken?
 *
 * Measured as the longest run of words shared between the end of the spoken text
 * and the start of the continuation. Three or more is the flag: one or two words
 * overlapping ("the", "and the") is ordinary English, whereas a model that
 * restarts the sentence reproduces a recognisable stretch of it.
 */
function overlapRun(spoken, continuation) {
  const before = words(spoken);
  const after = words(continuation);
  let best = 0;
  for (let start = 0; start < after.length; start += 1) {
    for (let length = 1; length <= after.length - start; length += 1) {
      const candidate = after.slice(start, start + length).join(' ');
      if (before.join(' ').includes(candidate)) best = Math.max(best, length);
      else break;
    }
  }
  return best;
}

async function run() {
  const keys = (process.env.GEMINI_API_KEY ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) {
    console.error(
      'GEMINI_API_KEY is not set. Load it without printing it:\n' +
        '  set -a; . apps/api/.env; set +a',
    );
    process.exit(2);
  }
  const asJson = process.argv.includes('--json');
  const only = process.argv.indexOf('--model');
  const models = only >= 0 ? [process.argv[only + 1]] : MODELS;
  const results = [];

  for (const model of models) {
    for (const [index, testCase] of CASES.entries()) {
      const spoken = [];
      const steps = [];
      let failed = null;

      for (const [position, clause] of testCase.clauses.entries()) {
        const prompt =
          position === 0
            ? firstPrompt(testCase.lang, clause)
            : continuationPrompt(testCase.lang, spoken.join(' '), clause);

        const started = Date.now();
        let text;
        try {
          text = await generate(keys, prompt, model);
        } catch (err) {
          // One exhausted model must not abandon the models after it. A partial
          // sweep that says so is worth more than no sweep at all, and the report
          // has to be able to tell "this model rewrites" from "this model was
          // never reached".
          failed = err.message;
          break;
        }
        const ms = Date.now() - started;

        const overlap = position === 0 ? 0 : overlapRun(spoken.join(' '), text);
        steps.push({ clause, text, ms, overlapWords: overlap, rewrote: overlap >= 3 });
        spoken.push(text);
      }

      results.push({
        model,
        case: index + 1,
        lang: testCase.lang,
        steps,
        failed,
        spoken: spoken.join(' '),
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let rewrites = 0;
  for (const result of results) {
    console.log(`\n=== ${result.model} · case ${result.case} (${result.lang}) ===`);
    if (result.failed) {
      console.log(`  NOT REACHED: ${result.failed}`);
      continue;
    }
    for (const [position, step] of result.steps.entries()) {
      const tag = position === 0 ? 'open ' : step.rewrote ? 'REWRO' : 'cont ';
      if (step.rewrote) rewrites += 1;
      console.log(`  [${tag}] ${String(step.ms).padStart(5)}ms  ${step.text}`);
      console.log(`          <- ${step.clause}`);
      if (position > 0) console.log(`          overlap with spoken: ${step.overlapWords} words`);
    }
    console.log(`  spoken end to end: ${result.spoken}`);
  }

  console.log('\n--- per model ---');
  for (const model of [...new Set(results.map((r) => r.model))]) {
    const forModel = results.filter((r) => r.model === model);
    const reached = forModel.filter((r) => !r.failed);
    const conts = reached.reduce((total, r) => total + r.steps.length - 1, 0);
    const bad = reached.reduce((total, r) => total + r.steps.filter((s) => s.rewrote).length, 0);
    const latencies = reached.flatMap((r) => r.steps.map((s) => s.ms)).sort((a, b) => a - b);
    console.log(
      `  ${model.padEnd(24)} ${reached.length}/${forModel.length} cases  ` +
        `${conts - bad}/${conts} clean  ` +
        `median ${latencies.length ? `${latencies[Math.floor(latencies.length / 2)]}ms` : '—'}`,
    );
  }

  const continuations = results
    .filter((r) => !r.failed)
    .reduce((total, r) => total + r.steps.length - 1, 0);
  console.log(
    `\n${continuations - rewrites}/${continuations} continuations did not reach backwards.`,
  );
  if (rewrites > 0) {
    console.log(
      'A rewrite means the listener would hear part of the sentence twice, worded\n' +
        'differently, with no way to retract the first version. Before building on\n' +
        'this prompt, try pinning the spoken text harder — or fall back to sending\n' +
        'only the new clause plus one clause of context, accepting looser cohesion.',
    );
  } else {
    console.log('The append-only prompt holds on these cases. Adopt this wording verbatim.');
  }
  console.log(
    '\nRead the end-to-end line as a listener, not as a diff: it can be free of\n' +
      'overlap and still not be a sentence anyone would say. That is the cost of\n' +
      'committing early, and it is a judgement this script cannot make for you.\n',
  );
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
