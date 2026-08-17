// Whether the CAUSAL stream's transcript stays put once a client appends it.
//
// `prefix-stability.mjs` asks this of a recogniser that re-reads a growing
// buffer. This asks it of the other path — `/stream/{id}/feed`, whose contract
// says a caller appends deltas and never replaces — and it exists because the
// two can disagree in a way that is easy to miss.
//
// Appending deltas makes the STRING monotone by construction. It does not make
// the WORDS monotone: a delta that begins mid-word rewrites the last word of
// what came before, and a word is the unit that gets spoken. So this compares
// tokenised transcripts, the way `StablePrefixCommitter` does, rather than
// comparing strings and concluding the obvious.
//
// A violation here is not cosmetic. It means a word the listener already heard
// was not the word the decoder ended up settling on.
//
// Usage:
//   node benchmarks/realtime/stream-prefix-stability.mjs fixtures/vlsp-vi-01.wav --lang vi
//   node benchmarks/realtime/stream-prefix-stability.mjs fixtures/vlsp-vi-01.wav --json out.json
//
// Needs the STT sidecar on :8002 with a causal engine for the language.

import { readFileSync, writeFileSync } from 'node:fs';
import { openWav } from './wav.mjs';

const STT_URL = process.env.LOCAL_STT_URL ?? 'http://localhost:8002';

/**
 * Audio per feed.
 *
 * Matches what `CausalTranscriber` sends: whatever arrived since the last feed
 * resolved, which at a 100ms client frame is one frame in the steady state.
 * Feeding in larger gulps would hide exactly the boundary effects this looks
 * for, because fewer boundaries would exist.
 */
const CHUNK_MS = 100;

/**
 * Tokenisation matching `normalizeForComparison` in the API.
 *
 * Kept deliberately literal rather than imported: this harness is plain Node
 * with no build step, and a violation reported here has to be checkable against
 * the shipped normalizer by reading both, not by trusting a shared import that
 * may be doing more than it appears to.
 */
function tokenize(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The accumulation minus its last word, mirroring `settledPrefix` in
 * `apps/api/src/modules/translate/session/causal-transcriber.ts`.
 *
 * Reported beside the raw view because the two answer different questions and
 * only one of them is about the listener. Raw says what the decoder emitted;
 * settled says what the commit path is allowed to speak. A violation in the RAW
 * column is expected — the decoder emits pieces — and a violation in the
 * SETTLED column is the bug.
 */
function settledPrefix(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(text.charAt(i))) return text.slice(0, i);
  }
  return '';
}

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  const lang = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : 'vi';
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  if (!file) throw new Error('usage: stream-prefix-stability.mjs <file.wav> [--lang vi]');

  const { sampleRate, pcm } = openWav(readFileSync(file));

  const opened = await fetch(`${STT_URL}/stream`, {
    method: 'POST',
    body: new URLSearchParams({ language: lang }),
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.status} ${await opened.text()}`);
  const { stream_id: streamId } = await opened.json();

  const bytesPerChunk = (sampleRate * 2 * CHUNK_MS) / 1000;
  let running = '';
  let tokens = [];
  let settledTokens = [];
  const violations = [];
  const settledViolations = [];
  let feeds = 0;

  for (let offset = 0; offset < pcm.length; offset += bytesPerChunk) {
    const chunk = pcm.subarray(offset, offset + bytesPerChunk);
    const response = await fetch(`${STT_URL}/stream/${streamId}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    if (!response.ok) throw new Error(`feed failed: ${response.status} ${await response.text()}`);
    const { text: delta } = await response.json();
    feeds += 1;
    if (!delta) continue;

    const next = running + delta;
    const nextTokens = tokenize(next);
    const shared = commonPrefixLength(tokens, nextTokens);
    if (shared < tokens.length) {
      violations.push({
        feed: feeds,
        lostTokens: tokens.length - shared,
        was: tokens.slice(shared).join(' '),
        became: nextTokens.slice(shared, tokens.length + 2).join(' '),
        delta,
      });
    }
    const nextSettled = tokenize(settledPrefix(next));
    const settledShared = commonPrefixLength(settledTokens, nextSettled);
    if (settledShared < settledTokens.length) {
      settledViolations.push({
        feed: feeds,
        lostTokens: settledTokens.length - settledShared,
        was: settledTokens.slice(settledShared).join(' '),
        became: nextSettled.slice(settledShared, settledTokens.length + 2).join(' '),
        delta,
      });
    }

    running = next;
    tokens = nextTokens;
    settledTokens = nextSettled;
  }

  const tail = await fetch(`${STT_URL}/stream/${streamId}/finalize`, { method: 'POST' });
  const { text: tailText } = await tail.json();
  if (tailText) {
    const nextTokens = tokenize(running + tailText);
    const shared = commonPrefixLength(tokens, nextTokens);
    if (shared < tokens.length) {
      violations.push({
        feed: 'finalize',
        lostTokens: tokens.length - shared,
        was: tokens.slice(shared).join(' '),
        became: nextTokens.slice(shared, tokens.length + 2).join(' '),
        delta: tailText,
      });
    }
    // The tail releases the withheld word, so the settled view is the whole
    // transcript from here. It must still extend what was already spoken.
    const settledShared = commonPrefixLength(settledTokens, nextTokens);
    if (settledShared < settledTokens.length) {
      settledViolations.push({
        feed: 'finalize',
        lostTokens: settledTokens.length - settledShared,
        was: settledTokens.slice(settledShared).join(' '),
        became: nextTokens.slice(settledShared, settledTokens.length + 2).join(' '),
        delta: tailText,
      });
    }
    running += tailText;
    tokens = nextTokens;
    settledTokens = nextTokens;
  }
  await fetch(`${STT_URL}/stream/${streamId}`, { method: 'DELETE' });

  const totalLost = violations.reduce((sum, v) => sum + v.lostTokens, 0);
  const settledLost = settledViolations.reduce((sum, v) => sum + v.lostTokens, 0);
  const result = {
    file,
    lang,
    feeds,
    words: tokens.length,
    violations: violations.length,
    tokensRewritten: totalLost,
    settledViolations: settledViolations.length,
    settledTokensRewritten: settledLost,
    detail: violations.slice(0, 20),
    settledDetail: settledViolations.slice(0, 20),
    transcript: running,
  };

  console.log(`feeds        ${feeds}`);
  console.log(`words        ${tokens.length}`);
  console.log(`raw          ${violations.length} violations (${totalLost} tokens rewritten)`);
  console.log(
    `settled      ${settledViolations.length} violations (${settledLost} tokens rewritten)  <- the one that matters`,
  );
  for (const v of settledViolations.slice(0, 10)) {
    console.log(`  feed ${v.feed}: "${v.was}" -> "${v.became}"   delta=${JSON.stringify(v.delta)}`);
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(result, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
