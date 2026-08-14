// Answers the one question the whole streaming-commit design rests on: when the
// SAME growing buffer is decoded again and again, does the transcript's prefix
// stay put?
//
// Nothing may be spoken aloud until it is certain, because audio that has played
// cannot be taken back. The certainty comes from LocalAgreement: a prefix is
// committed once N consecutive reads agree on it. That only works if the
// recogniser is prefix-monotone in practice — and both engines here are OFFLINE
// recognisers being re-run on a longer buffer each time, which nothing obliges to
// be monotone at all.
//
// So this measures it rather than assuming it, and it measures the thing that
// actually matters: not "did the text change" but "did a word we would ALREADY
// HAVE SPOKEN turn out to be wrong".
//
// Usage:
//   node benchmarks/realtime/prefix-stability.mjs <file.wav> --lang vi
//   node benchmarks/realtime/prefix-stability.mjs --lang en --tts "Hello, ..."
//   node benchmarks/realtime/prefix-stability.mjs fixture.wav --lang vi --json
//
// The `--tts` form synthesizes its own input through the TTS sidecar. It is for
// reproducing a known measurement quickly, NOT for choosing the threshold:
// synthetic speech has no disfluency and no room tone, so it flatters this test.
// The threshold that ships must come from the dataset fixtures.
//
// Needs the STT sidecar on :8002 (and :8003 for `--tts`).

import { readFileSync, writeFileSync } from 'node:fs';
import { openWav, writeWav, bytesPerMs, durationMs } from './wav.mjs';

const STT_URL = process.env.LOCAL_STT_URL ?? 'http://localhost:8002';
const TTS_URL = process.env.LOCAL_TTS_URL ?? 'http://localhost:8003';

/**
 * How often the buffer is re-read.
 *
 * Matches `DEFAULT_CADENCE_MS` in
 * `apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts`. If that
 * changes, this must change with it: a threshold measured at one cadence does not
 * transfer to another, because agreement depth is counted in READS, and reads
 * arriving twice as often carry half as much new audio each.
 */
const STEP_MS = 300;

/** Agreement depths to sweep. The shallowest with zero contradictions wins. */
const DEPTHS = [2, 3, 4];

/**
 * Trailing audio each read decodes, matching `DEFAULT_WINDOW_SECONDS` in
 * `partial-transcript-scheduler.ts`. `--window-s 0` decodes the whole buffer.
 *
 * This is not a performance knob, and measurement is what settled that. Decoding
 * the WHOLE growing buffer, the same recording needed a deeper and deeper
 * agreement threshold the longer it ran — depth 2 at 8s, 3 at 16s, 4 at 42s —
 * and the contradictions were always the same shape: a word already spoken
 * vanishing from the next read rather than changing into another word. The
 * offline recogniser simply gets less stable at the tail as its input grows.
 *
 * The window bounds that. Production never hands the recogniser more than this,
 * so it stays in the regime where a shallow threshold is safe — which makes this
 * constant load-bearing for commit SAFETY, not just for cost. Widening it "for
 * better context" would quietly buy back the instability that a spoken commit
 * cannot survive.
 */
const DEFAULT_WINDOW_S = 8;

/**
 * How many tokens may fall out of the front of the window between two reads.
 *
 * Reads are `STEP_MS` apart and speech runs a few words a second, so one or two
 * is normal; the ceiling only bounds the search.
 */
const MAX_TOKENS_DROPPED_PER_READ = 6;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Comparison happens on normalized tokens, and that is not a detail — it is a
// finding. Moonshine rewrites its own already-emitted text between reads:
// measured here, "seven" became "7" after the audio grew. Compared raw, that is
// an already-committed word changing, which would report a contradiction on
// every English turn forever and push the threshold deeper for no reason.
//
// The number table is deliberately small and bounded rather than a general
// number-to-words converter. It covers what a spoken sentence actually contains
// at the point a recogniser flip-flops on notation. A digit outside the table is
// left as-is: it then compares equal only to the same digit, which is the safe
// direction — it can report a contradiction that is really notation, never hide
// a real one.
const NUMBER_WORDS = {
  en: [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ],
  vi: [
    'không',
    'một',
    'hai',
    'ba',
    'bốn',
    'năm',
    'sáu',
    'bảy',
    'tám',
    'chín',
    'mười',
    'mười một',
    'mười hai',
    'mười ba',
    'mười bốn',
    'mười lăm',
    'mười sáu',
    'mười bảy',
    'mười tám',
    'mười chín',
    'hai mươi',
  ],
};

/**
 * Turn a transcript into the token stream agreement is judged on.
 *
 * Used ONLY for comparison. The text handed to translation is always the raw
 * transcript — notation carries meaning to a translator, and a model given
 * "seven" reads differently from one given "7".
 */
export function normalizeTokens(text, lang) {
  const words = NUMBER_WORDS[lang] ?? NUMBER_WORDS.en;
  return (
    text
      .toLowerCase()
      // Punctuation is stripped rather than compared: the engines disagree about it
      // constantly (Moonshine emits it, the Vietnamese Zipformer emits none at all
      // — see `services/local-stt/engines/zipformer_vi.py`), and a comma is never
      // the reason a spoken word was wrong.
      .replace(/[.,!?;:…"'`()\[\]]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((token) => {
        if (!/^\d+$/.test(token)) return [token];
        const value = Number(token);
        // Multi-word expansions are split, so "15" and "mười lăm" line up token
        // for token instead of comparing one token against two.
        return value < words.length ? words[value].split(' ') : [token];
      })
  );
}

const commonPrefixLength = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};

// ---------------------------------------------------------------------------
// Commit simulation
// ---------------------------------------------------------------------------

/**
 * How many tokens fell out of the front of the window between two reads.
 *
 * Picked as the shift that best lines the older read up with the newer one. Only
 * needed in windowed mode: the window slides, so the same word sits at a
 * different index in each read, and comparing raw indices would report a
 * contradiction every single time the window moved.
 */
function alignOffset(previousVisible, current) {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(MAX_TOKENS_DROPPED_PER_READ, previousVisible.length);
  for (let drop = 0; drop <= limit; drop += 1) {
    const score = commonPrefixLength(previousVisible.slice(drop), current);
    if (score > bestScore) {
      bestScore = score;
      best = drop;
    }
  }
  return best;
}

/**
 * Re-express window-local reads as one absolute token stream.
 *
 * Text that has scrolled out of the window is carried forward from history
 * rather than re-verified, because production cannot re-verify it either — and
 * that is the point rather than a limitation. A commit older than the window is
 * permanently safe: no later read can reach back and disown it. Modelling that
 * faithfully is the whole reason windowed mode exists here.
 */
function toAbsolute(reads) {
  let history = [];
  let offset = 0;
  return reads.map((read, index) => {
    if (index > 0) offset += alignOffset(history.slice(offset), read.tokens);
    const tokens = [...history.slice(0, offset), ...read.tokens];
    history = tokens;
    return { ...read, tokens };
  });
}

/**
 * Replay one depth's commit policy over the reads and report what it would have
 * spoken, and what it would have got wrong.
 *
 * The committed prefix only ever grows. That is the policy, not a shortcut: once a word is
 * spoken there is no mechanism to unspeak it, so a later read that disagrees is
 * counted as damage rather than applied as a correction.
 */
function simulate(reads, depth) {
  // The actual words that would have been SPOKEN, not merely how many.
  //
  // Keeping a count was a real bug and worth naming, because it failed in the
  // flattering direction: the check compared the current read against itself, so
  // it could only ever notice a read growing SHORTER than the commit count, and
  // was blind to the case that matters most — a committed word replaced by a
  // different word. Every "0 contradictions" it printed was therefore weaker
  // than it looked, and every contradiction it did print was a truncation.
  let committedTokens = [];
  let contradictions = 0;
  const contradicted = [];
  // How long a word waits between being decodable and being safe to speak. This
  // is the latency the threshold costs, and it is why the shallowest workable
  // depth is the one to ship.
  const commitDelays = [];
  const firstSeenAt = new Map();

  reads.forEach((read, index) => {
    read.tokens.forEach((token, position) => {
      const key = `${position}:${token}`;
      if (!firstSeenAt.has(key)) firstSeenAt.set(key, index);
    });

    if (index + 1 < depth) return;

    // The prefix all of the last `depth` reads agree on.
    const window = reads.slice(index - depth + 1, index + 1);
    let agreed = window[0].tokens.length;
    for (const other of window.slice(1)) {
      agreed = Math.min(agreed, commonPrefixLength(window[0].tokens, other.tokens));
    }

    // Does this read still support every word already spoken? Compared against
    // the words themselves, so a substitution counts — that is the failure a
    // listener actually hears, and the one a count could never see.
    const stillSupported = commonPrefixLength(committedTokens, read.tokens);
    if (stillSupported < committedTokens.length) {
      contradictions += 1;
      contradicted.push({
        atMs: read.atMs,
        spoken: committedTokens.slice(stillSupported).join(' '),
        became:
          read.tokens.slice(stillSupported, committedTokens.length + 2).join(' ') || '(nothing)',
      });
      // The spoken words stand: they cannot be unsaid, so the policy keeps them
      // and the damage is counted once rather than re-counted on every later read.
    }

    if (agreed > committedTokens.length) {
      for (let position = committedTokens.length; position < agreed; position += 1) {
        const seen = firstSeenAt.get(`${position}:${read.tokens[position]}`);
        if (seen !== undefined) commitDelays.push((index - seen) * STEP_MS);
      }
      committedTokens = read.tokens.slice(0, agreed);
    }
  });

  const finalTokens = reads.at(-1)?.tokens.length ?? 0;
  return {
    depth,
    contradictions,
    contradicted,
    committed: committedTokens.length,
    // Words the policy never dared speak. They are not lost — the endpoint
    // translates whatever is left — but a large tail means the listener waits for
    // the end of the utterance for a large part of it, which is the thing this
    // whole design exists to avoid.
    uncommittedTail: finalTokens - committedTokens.length,
    medianCommitDelayMs: median(commitDelays),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

async function synthesize(text, lang) {
  const res = await fetch(`${TTS_URL}/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language: lang }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribe(wav, lang) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
  form.append('language', lang);
  const started = Date.now();
  const res = await fetch(`${STT_URL}/transcribe`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`stt ${res.status}: ${await res.text()}`);
  const { text } = await res.json();
  return { text, decodeMs: Date.now() - started };
}

// ---------------------------------------------------------------------------

async function collectReads(wav, lang, windowMs, onRead) {
  const audio = openWav(wav);
  const perMs = bytesPerMs(audio);
  const totalMs = durationMs(audio);
  const reads = [];

  for (let atMs = STEP_MS; ; atMs += STEP_MS) {
    const clamped = Math.min(atMs, totalMs);
    const startMs = windowMs > 0 ? Math.max(0, clamped - windowMs) : 0;
    // A window is a slice from both ends, so it cannot reuse `sliceWav`, which
    // only trims the tail.
    const body = audio.pcm.subarray(Math.floor(startMs * perMs), Math.floor(clamped * perMs));
    const { text, decodeMs } = await transcribe(writeWav(audio, body), lang);

    const read = { atMs: clamped, startMs, text, decodeMs, tokens: normalizeTokens(text, lang) };
    reads.push(read);
    onRead?.(read);
    if (clamped >= totalMs) break;
  }

  // Windowed reads describe a moving slice, so they are stitched into one
  // absolute stream before the commit policy sees them.
  return {
    reads: windowMs > 0 ? toAbsolute(reads) : reads,
    totalMs,
    sampleRate: audio.sampleRate,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name, fallback = null) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const lang = flag('lang', 'vi');
  const tts = flag('tts');
  const files = args.filter((a) => !a.startsWith('--') && a !== lang && a !== tts);
  const asJson = args.includes('--json');
  const windowMs = Number(flag('window-s', DEFAULT_WINDOW_S)) * 1000;

  if (!files.length && !tts) {
    console.error(
      'usage: node benchmarks/realtime/prefix-stability.mjs <file.wav> --lang vi|en\n' +
        '       node benchmarks/realtime/prefix-stability.mjs --lang en --tts "text"\n' +
        `  --window-s N  trailing audio each read decodes (default ${DEFAULT_WINDOW_S}, matching\n` +
        '                production). 0 decodes the whole buffer, which is a DIFFERENT and\n' +
        '                less stable regime — the threshold it recommends is not the one to ship.\n' +
        '  --tts synthesizes its own input; good for a smoke test, NOT for choosing\n' +
        '  the shipped threshold — synthetic speech has no disfluency.',
    );
    process.exit(2);
  }
  return { lang, tts, file: files[0], asJson, windowMs };
}

async function run() {
  const { lang, tts, file, asJson, windowMs } = main(process.argv);

  let wav;
  let source;
  if (tts) {
    wav = await synthesize(tts, lang);
    source = `tts:"${tts.slice(0, 40)}${tts.length > 40 ? '…' : ''}"`;
    writeFileSync(`/tmp/prefix-stability-${lang}.wav`, wav);
  } else {
    wav = readFileSync(file);
    source = file;
  }

  const verbose = !asJson;
  if (verbose) console.log(`lang=${lang}  source=${source}`);

  const { reads, totalMs, sampleRate } = await collectReads(wav, lang, windowMs, (read) => {
    if (!verbose) return;
    console.log(
      `${String(read.atMs).padStart(6)}ms  decode ${String(read.decodeMs).padStart(4)}ms  ` +
        `${String(read.tokens.length).padStart(3)} tok | ${read.text}`,
    );
  });

  const decodes = reads.map((r) => r.decodeMs);
  const sweep = DEPTHS.map((depth) => simulate(reads, depth));
  // The shallowest depth that never contradicted itself. Shallower is better:
  // every extra read of agreement is another STEP_MS the listener waits.
  const recommended = sweep.find((s) => s.contradictions === 0) ?? null;

  const result = {
    source,
    lang,
    sampleRate,
    durationMs: totalMs,
    reads: reads.length,
    decodeP50Ms: median(decodes),
    decodeMaxMs: Math.max(...decodes),
    finalText: reads.at(-1)?.text ?? '',
    sweep,
    recommendedDepth: recommended?.depth ?? null,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `\ndecode p50 ${result.decodeP50Ms}ms  max ${result.decodeMaxMs}ms  over ${reads.length} reads`,
  );
  console.log('\n--- agreement sweep ---');
  console.log('depth  contradictions  committed  tail  median wait');
  for (const s of sweep) {
    console.log(
      `${String(s.depth).padStart(5)}  ${String(s.contradictions).padStart(14)}  ` +
        `${String(s.committed).padStart(9)}  ${String(s.uncommittedTail).padStart(4)}  ` +
        `${s.medianCommitDelayMs === null ? '—' : `${s.medianCommitDelayMs}ms`}`,
    );
  }

  for (const s of sweep) {
    for (const c of s.contradicted) {
      console.log(
        `  depth ${s.depth} @${c.atMs}ms: spoke "${c.spoken}" — read became "${c.became}"`,
      );
    }
  }

  console.log(
    `\nrecommended depth for ${lang}: ${result.recommendedDepth ?? 'NONE — no depth was safe'}`,
  );
  if (result.recommendedDepth === null) {
    console.log(
      '  No depth reached zero contradictions on this input. Do NOT ship a commit\n' +
        '  policy against it: it would speak words the recogniser later disowns, and\n' +
        "  spoken audio cannot be retracted. Re-read the plan's fallback (keep turns,\n" +
        '  cut them shorter at pauses) before going further.',
    );
  }
  console.log(
    '\nOne file is one sample. The shipped threshold is the deepest recommendation\n' +
      'across the whole fixture matrix, not the result of a single lucky recording.\n',
  );
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
