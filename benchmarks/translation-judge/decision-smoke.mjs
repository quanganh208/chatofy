// Live smoke for the decision hosts: Gemini on its first two keys, Jev once.
// Three calls at most. Prints status, latency, the answer and the served
// model; never a key. A missing Jev key is reported, not an error.
//
//   node benchmarks/translation-judge/decision-smoke.mjs
import { CallCounter, geminiDecisionAsker, jevAsker, loadKey } from './decision-providers.mjs';

const STATE = {
  source: 'Hôm nay trời đẹp. Đi chơi nhé.',
  translation: 'The weather is nice today.',
};
const QUESTIONS = {
  covers_all: {
    type: 'noul',
    instructions: 'Does `translation` convey every sentence of `source`?',
  },
};

async function report(name, ask) {
  try {
    const out = await ask(STATE, QUESTIONS);
    console.log(
      `${name}: 200 ${out.ms} ms noul ${out.answers.covers_all.noul} servedBy ${out.servedBy}`,
    );
  } catch (error) {
    console.log(`${name}: FAILED ${error.message}`);
    process.exitCode = 1;
  }
}

const keys = loadKey('GEMINI_API_KEY')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
console.log(`gemini keys: ${keys.length}`);
for (const [i, key] of keys.slice(0, 2).entries()) {
  await report(
    `gemini key ${i + 1}`,
    geminiDecisionAsker({ keys: [key], counter: new CallCounter(1), minGapMs: 0 }),
  );
}
if (loadKey('TYPESAFE_API_KEY'))
  await report('jev', jevAsker({ counter: new CallCounter(1), minGapMs: 0 }));
else console.log('jev: not run (no key)');
