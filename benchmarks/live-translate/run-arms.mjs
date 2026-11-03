// Play every fixture through both systems and time them the same way.
//
// The two arms:
//
//   cascade — /ws/translate, the shipped turn-based path. This harness has to
//             speak the turn contract itself, because nothing in the repo does
//             headlessly, and that means IT decides when `client.session.end`
//             is sent. That choice sets the cascade's measured latency and is
//             the single most load-bearing decision in this file. See below.
//   live    — Gemini Live (`gemini-3.5-live-translate-preview`), dialed
//             directly from this process with GEMINI_API_KEY; the app no longer
//             has a live mode. One session per utterance, so output is
//             attributable without forced alignment and the ~30-minute session
//             window cannot expire mid-run.
//
// Interleaved: utterance i goes through both arms back to back, same machine,
// same network, one window. A preview model updated between two sequential arms
// would invalidate the chapter silently.
//
// Everything is paced at wall clock. Feeding faster than real time makes both
// arms' latency fiction.
//
// Usage:
//   node benchmarks/live-translate/run-arms.mjs --api http://localhost:3000
//   node benchmarks/live-translate/run-arms.mjs --only vi --limit 5
//   node benchmarks/live-translate/run-arms.mjs --arms cascade   # skip the live arm
//   node benchmarks/live-translate/run-arms.mjs --arms live --limit 1 --out /tmp/x  # no API needed
//
// `--arms cascade` runs the cascade alone — for measuring a change to the
// cascade itself, where spending the live arm's preview quota buys nothing.
// Rows from such a run are not an interleaved comparison and must not be read
// as one.
//
// The cascade's /ws/translate requires a token; the live arm needs none, only
// GEMINI_API_KEY (environment first, then the repo-root .env). By default the harness mints a throwaway
// account on first use, keeps it in an untracked file beside this script, and
// reuses it on later runs; pass --token to supply one instead, or
// --email/--password to name the account it should use.

import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { speechEndMs, firstSpeechSampleIndex, speechDurationMs } from './vad-anchor.mjs';
import { resolveGeminiApiKey } from './gemini-api-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const RESULTS = join(HERE, 'results');
/**
 * Where the harness keeps the account it signs in as. Untracked, see .gitignore.
 *
 * The credential is generated on first use rather than defaulted to a constant
 * in this file. A password written here would be a published one, and
 * `POST /auth/register` is open — so pointing `--api` at any deployment would
 * have the harness create an account there whose password anyone can read.
 */
const ACCOUNT_FILE = join(HERE, '.harness-account.json');

const CHUNK_MS = 100;
const IN_RATE = 16000;

/**
 * How long after the VAD end of speech the cascade arm declares its endpoint.
 *
 * `SPEECH_HANGOVER_MS` from `packages/realtime-client/src/audio/speech-gate.ts`.
 * This is the decision the whole comparison rests on:
 *
 *   Sending at the VAD end exactly would hand the cascade an ORACLE endpoint no
 *   real client has — the same sin as anchoring on `speechEndedAt`, committed in
 *   the opposite direction, flattering our own system instead of Gemini.
 *
 *   Sending at VAD end + hangover reproduces what a real user actually waits
 *   through, because the shipped gate needs that much silence to decide.
 *
 * The shipped client ALSO speculates, which this harness does not use. So the
 * cascade's real latency is at most what is measured here — every simplification
 * biases against our own system, which is the safe direction to be wrong in.
 * The chapter must say so.
 */
const CASCADE_HANGOVER_MS = 500;

/** How long to wait for an arm to finish after the audio stops. */
const DRAIN_MS = 25000;
/** Give up on an arm that has said nothing new for this long. */
const QUIET_MS = 6000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPcm16Wav(path) {
  const buf = readFileSync(path);
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') fmt = { sampleRate: buf.readUInt32LE(body + 4) };
    else if (id === 'data') return { fmt, samples: buf.subarray(body, body + size) };
    offset = body + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

function wrapPcm16Wav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The subprotocol name the API selects, and beside which the token rides.
 *
 * Duplicated from `@chatofy/types` rather than imported: this harness is not
 * part of the pnpm workspace and never imports the app, the same convention
 * `benchmarks/stt` and `benchmarks/realtime` follow.
 */
const WS_SUBPROTOCOL = 'chatofy-v1';

/**
 * Open a socket and resolve once it is usable.
 *
 * The token is offered as the second subprotocol, exactly as the browsers do —
 * `/ws/translate` refuses an unauthenticated upgrade with HTTP 401 before any
 * socket exists, and node's `WebSocket` takes the identical two-argument form.
 * A refused upgrade surfaces here only as a failure to open, which is why the
 * login preamble runs once up front and fails loudly.
 */
function connect(url, accessToken) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, [WS_SUBPROTOCOL, accessToken]);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${url}`)), {
      once: true,
    });
  });
}

/**
 * The account to sign in as, minted once and remembered.
 *
 * Reads {@link ACCOUNT_FILE}, generating a fresh email and a random password the
 * first time, so a rerun against the same database reuses the same throwaway
 * account without a manual setup step and without a credential living in this
 * file. Explicit `--email` / `--password` win over both.
 */
function harnessAccount({ email, password }) {
  if (email && password) return { email, password };

  let stored = null;
  try {
    stored = JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8'));
  } catch {
    // Absent on a first run, and unreadable if it was hand-edited. Either way
    // there is nothing to reuse, and minting a new pair is the recovery.
  }

  const account = {
    email: email ?? stored?.email ?? `bench-harness-${randomUUID()}@chatofy.local`,
    password: password ?? stored?.password ?? randomBytes(24).toString('base64url'),
  };
  writeFileSync(ACCOUNT_FILE, `${JSON.stringify(account, null, 2)}\n`);
  return account;
}

/**
 * Obtain an access token before any measurement starts.
 *
 * LOGS IN ONLY. It used to register the account and fall back to logging in, so
 * a first run needed no setup — that stopped working when registration became
 * deferred: `POST /auth/register` now creates no account and answers 202 with no
 * token, and the account exists only once the mailed verification link has been
 * followed. A harness cannot follow that link, so it cannot bootstrap its own
 * identity any more and says so instead of failing on an undefined token.
 *
 * Deliberately outside the timed section: this is one HTTP round trip per RUN,
 * not per utterance, so it cannot appear in any latency figure.
 */
async function obtainToken(api, { email, password }) {
  const post = async (path, body) => {
    const res = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const out = await post('/auth/login', { email, password });

  const token = out.body?.data?.token?.accessToken;
  if (!token) {
    throw new Error(
      `could not sign in to ${api} as ${email} (HTTP ${out.status}): ` +
        `${JSON.stringify(out.body?.error ?? out.body)}\n` +
        'Registration is verified by email, so this harness cannot create its own ' +
        'account. Either register this address through the web app and follow the ' +
        'link, or pass --token with a token you already hold.',
    );
  }
  return token;
}

/**
 * The wire's `{ source, target }` for a result row. Rows keep the `direction`
 * string they have always been recorded and analysed with (`analyze.mjs` groups
 * by it); only what is SENT to the server is a pair.
 */
function languagePairOf(direction) {
  const [source, target] = direction.split('_to_');
  return { source, target };
}

/**
 * One arm's measurement of one utterance.
 *
 * Both arms fill the same fields, measured at the SAME boundary — this process,
 * on receipt. Taking the cascade's numbers from its server-side JSONL and the
 * live arm's from here would be an asymmetry an examiner can attack, and it is
 * the reason the server's own rows are treated as operational telemetry rather
 * than as evidence.
 */
function blankResult(arm, utterance) {
  return {
    arm,
    id: utterance.id,
    lang: utterance.lang,
    direction: utterance.lang === 'vi' ? 'vi_to_en' : 'en_to_vi',
    speechMs: utterance.speechMs,
    vadEndMs: null,
    firstAudioAfterSpeechEndMs: null,
    lastAudioAfterSpeechEndMs: null,
    outputSpeechMs: null,
    outputBytes: 0,
    transcript: '',
    detectedLangs: [],
    error: null,
  };
}

/**
 * Stream one utterance through the turn-based path.
 *
 * Speaks the contract from `packages/types/src/events/ws-events.ts` directly.
 * `client.turn.speculate` is deliberately never sent — see CASCADE_HANGOVER_MS.
 */
async function runCascade(apiWsBase, accessToken, utterance, samples, vadEnd, outDir) {
  const result = blankResult('cascade', utterance);
  result.vadEndMs = vadEnd;
  const socket = await connect(`${apiWsBase}/ws/translate`, accessToken);
  const chunks = [];
  let outRate = 0;
  let firstAudioAt = null;
  let lastAudioAt = null;
  let lastEventAt = Date.now();
  let sessionId = null;
  let ended = false;

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === 'server.session.ready') sessionId = msg.sessionId;
    if (msg.type === 'server.transcript.final') {
      lastEventAt = Date.now();
      const { target } = languagePairOf(result.direction);
      result.transcript = msg.segment?.translations?.[target] ?? result.transcript;
    }
    if (msg.type === 'server.audio.frame') {
      const pcm = Buffer.from(msg.frame.payload, 'base64');
      outRate = msg.frame.sampleRate;
      chunks.push(pcm);
      result.outputBytes += pcm.length;
      // First audio means first SPEECH, not first frame. A frame of silence
      // would otherwise set the headline number.
      if (firstAudioAt === null && firstSpeechSampleIndex(pcm, outRate) !== null) {
        firstAudioAt = Date.now();
      }
      lastAudioAt = Date.now();
      lastEventAt = Date.now();
    }
    if (msg.type === 'server.session.ended') ended = true;
    if (msg.type === 'server.error') result.error = `${msg.code}: ${msg.message}`;
  });

  const send = (event, data) => socket.send(JSON.stringify({ event, data }));
  send('client.session.start', {
    type: 'client.session.start',
    languagePair: languagePairOf(result.direction),
    voiceGender: 'female',
  });
  // Wait for the id rather than sleeping a guessed interval: a frame that names
  // no turn is refused, and on a slow start that silently truncates the turn.
  const readyDeadline = Date.now() + 10000;
  while (sessionId === null && Date.now() < readyDeadline) await sleep(20);
  if (sessionId === null) {
    socket.close();
    result.error ??= 'never received server.session.ready';
    return result;
  }

  /**
   * The cascade hears the speech plus the gate's hangover, and NOTHING after.
   *
   * The fixtures carry 4 s of trailing silence because the continuous model
   * needs it to know an utterance ended. The turn path is the opposite: its
   * endpoint is declared, and audio arriving after that lands in a buffer the
   * server is already reading — which is refused as `session_busy`, and would
   * make the cascade arm fail on every single utterance.
   *
   * Truncating here is not a favour to the cascade. It is what the shipped gate
   * does: it stops capturing when it closes the turn.
   */
  const audibleBytes = Math.ceil((((vadEnd + CASCADE_HANGOVER_MS) / 1000) * IN_RATE * 2) / 2) * 2;
  const audible = samples.subarray(0, Math.min(audibleBytes, samples.length));

  const bytesPerChunk = (IN_RATE * 2 * CHUNK_MS) / 1000;
  const startedAt = Date.now();
  const vadEndAt = startedAt + vadEnd;
  for (let offset = 0, i = 0; offset < audible.length; offset += bytesPerChunk, i += 1) {
    send('client.audio.frame', {
      type: 'client.audio.frame',
      frame: {
        sessionId,
        encoding: 'pcm16',
        sampleRate: IN_RATE,
        sequence: i,
        timestamp: Date.now(),
        payload: audible.subarray(offset, offset + bytesPerChunk).toString('base64'),
      },
    });
    const wait = startedAt + (i + 1) * CHUNK_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  // Declared once the hangover has elapsed in wall clock, which is where a real
  // gate would have closed the turn.
  send('client.session.end', { type: 'client.session.end', sessionId });

  const deadline = Date.now() + DRAIN_MS;
  while (Date.now() < deadline && !ended) {
    if (Date.now() - lastEventAt > QUIET_MS && chunks.length > 0) break;
    await sleep(100);
  }
  socket.close();

  const pcm = Buffer.concat(chunks);
  if (pcm.length > 0) {
    writeFileSync(join(outDir, `${utterance.id}-cascade.wav`), wrapPcm16Wav(pcm, outRate));
    result.outputSpeechMs = Math.round(speechDurationMs(pcm, outRate));
  }
  result.firstAudioAfterSpeechEndMs = firstAudioAt ? firstAudioAt - vadEndAt : null;
  result.lastAudioAfterSpeechEndMs = lastAudioAt ? lastAudioAt - vadEndAt : null;
  return result;
}

/** The model the live arm measures, recorded on every live row. */
const LIVE_MODEL = 'gemini-3.5-live-translate-preview';

/** The Gemini Developer API's bidirectional Live endpoint, v1beta as the SDK uses. */
const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Languages a detected tag is recognised as, mirrored from the app's registry.
 *
 * A tag outside this set is recorded as the source language, exactly as the
 * app-side provider used to report it, so `analyze.mjs`'s wrong-language count
 * keeps the meaning it had on rows taken before the live arm went direct.
 */
const KNOWN_LANGS = new Set(['vi', 'en', 'zh']);

/** `vi-VN` → `vi`; an absent or unknown tag → the language the fixture is in. */
function detectedLang(tag, fallback) {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return KNOWN_LANGS.has(primary) ? primary : fallback;
}

/**
 * The sample rate out of `audio/pcm;rate=24000`. Read rather than assumed: the
 * output rate is the model's and differs from the 16 kHz input, and a wrong
 * guess yields audio at the wrong speed that no byte count would catch.
 */
function rateFromMimeType(mimeType) {
  const match = /rate=(\d+)/.exec(mimeType ?? '');
  const rate = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Stream one utterance through Gemini Live, dialed directly from this process.
 *
 * Speaks the raw BidiGenerateContent protocol over Node's global WebSocket, so
 * the harness needs no SDK and never touches the app. The setup message is the
 * one the SDK builds for the configuration the app used to ship: audio out,
 * both transcriptions on, and a translation config that names the target only.
 * The model detects the source itself; there is no field to tell it.
 *
 * Timed at the same boundary as the cascade — this process, on receipt — and
 * paced the same way, 100 ms chunks at wall clock with the 4 s trailing silence
 * the continuous model needs to know the utterance ended.
 */
async function runLive(apiKey, utterance, samples, vadEnd, outDir) {
  const result = blankResult('live', utterance);
  result.vadEndMs = vadEnd;
  const { source, target } = languagePairOf(result.direction);

  const socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => resolve(ws), { once: true });
    // The URL carries the key, so it is never put in the message.
    ws.addEventListener('error', () => reject(new Error('cannot open the Gemini Live socket')), {
      once: true,
    });
  });

  const chunks = [];
  let outRate = 0;
  let firstAudioAt = null;
  let lastAudioAt = null;
  let lastEventAt = Date.now();
  let ready = false;
  let ended = false;
  let closingOurselves = false;

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      const text =
        typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
      msg = JSON.parse(text);
    } catch {
      result.error ??= 'unparseable message from Gemini Live';
      return;
    }
    if (msg.setupComplete) ready = true;
    if (msg.error) result.error ??= `upstream: ${JSON.stringify(msg.error).slice(0, 300)}`;

    const content = msg.serverContent;
    if (!content) return;
    const input = content.inputTranscription;
    if (input?.text) {
      lastEventAt = Date.now();
      const lang = detectedLang(input.languageCode, source);
      if (!result.detectedLangs.includes(lang)) result.detectedLangs.push(lang);
    }
    if (content.outputTranscription?.text) {
      lastEventAt = Date.now();
      result.transcript += content.outputTranscription.text;
    }
    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part?.inlineData;
      if (!inline?.data) continue;
      const rate = rateFromMimeType(inline.mimeType);
      if (rate === null) {
        result.error ??= `audio with an unreadable rate: ${inline.mimeType}`;
        continue;
      }
      const pcm = Buffer.from(inline.data, 'base64');
      outRate = rate;
      chunks.push(pcm);
      result.outputBytes += pcm.length;
      // First audio means first SPEECH: the model mirrors input silence back.
      if (firstAudioAt === null && firstSpeechSampleIndex(pcm, outRate) !== null) {
        firstAudioAt = Date.now();
      }
      lastAudioAt = Date.now();
      lastEventAt = Date.now();
    }
  });

  // The Live API reports a rejected key, an unknown model or exhausted quota by
  // closing the socket with a reason, not with an error message.
  socket.addEventListener('close', (event) => {
    ended = true;
    if (!closingOurselves && event.code !== 1000) {
      result.error ??= `closed ${event.code}: ${event.reason || 'no reason given'}`;
    }
  });

  socket.send(
    JSON.stringify({
      setup: {
        model: `models/${LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          // False, so speech already in the target language is silenced rather
          // than repeated — the setting the app shipped.
          translationConfig: { targetLanguageCode: target, echoTargetLanguage: false },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  );

  // Dialing and setup are not part of the latency being measured; the clock
  // starts when audio does.
  const readyDeadline = Date.now() + 15000;
  while (!ready && !ended && Date.now() < readyDeadline) await sleep(50);
  if (!ready) {
    closingOurselves = true;
    socket.close();
    result.error ??= 'never received setupComplete';
    return result;
  }

  const bytesPerChunk = (IN_RATE * 2 * CHUNK_MS) / 1000;
  const startedAt = Date.now();
  const vadEndAt = startedAt + vadEnd;
  for (let offset = 0, i = 0; offset < samples.length && !ended; offset += bytesPerChunk, i += 1) {
    socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: samples.subarray(offset, offset + bytesPerChunk).toString('base64'),
            mimeType: `audio/pcm;rate=${IN_RATE}`,
          },
        },
      }),
    );
    const wait = startedAt + (i + 1) * CHUNK_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }

  const deadline = Date.now() + DRAIN_MS;
  while (Date.now() < deadline && !ended) {
    if (Date.now() - lastEventAt > QUIET_MS && chunks.length > 0) break;
    await sleep(100);
  }
  closingOurselves = true;
  socket.close(1000);

  const pcm = Buffer.concat(chunks);
  if (pcm.length > 0) {
    writeFileSync(join(outDir, `${utterance.id}-live.wav`), wrapPcm16Wav(pcm, outRate));
    result.outputSpeechMs = Math.round(speechDurationMs(pcm, outRate));
  }
  result.firstAudioAfterSpeechEndMs = firstAudioAt ? firstAudioAt - vadEndAt : null;
  result.lastAudioAfterSpeechEndMs = lastAudioAt ? lastAudioAt - vadEndAt : null;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
  };
  const api = argOf('--api', 'http://localhost:3000');
  const only = argOf('--only', null);
  const limit = Number(argOf('--limit', Infinity));
  const armNames = argOf('--arms', 'cascade,live').split(',');
  const arms = [
    ['cascade', (...rest) => runCascade(wsBase, accessToken, ...rest)],
    ['live', (...rest) => runLive(geminiApiKey, ...rest)],
  ].filter(([name]) => armNames.includes(name));
  if (arms.length === 0) throw new Error(`--arms must name cascade and/or live, got ${armNames}`);
  const wsBase = api.replace(/^http/, 'ws');
  const runsCascade = arms.some(([name]) => name === 'cascade');
  const runsLive = arms.some(([name]) => name === 'live');

  // Before anything is measured: /ws/translate refuses an unauthenticated
  // upgrade, and Gemini Live refuses a missing key — a run that discovers either
  // on utterance 1 has already opened an output directory for nothing.
  const accessToken = runsCascade
    ? (argOf('--token', null) ??
      (await obtainToken(
        api,
        harnessAccount({
          email: argOf('--email', null),
          password: argOf('--password', null),
        }),
      )))
    : null;
  const geminiApiKey = runsLive ? resolveGeminiApiKey() : null;
  if (runsLive && !geminiApiKey) {
    throw new Error('the live arm needs GEMINI_API_KEY in the environment or the repo-root .env');
  }

  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
  const utterances = manifest.utterances.filter((u) => !only || u.lang === only).slice(0, limit);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = argOf('--out', join(RESULTS, stamp));
  mkdirSync(join(outDir, 'audio'), { recursive: true });
  const rowsPath = join(outDir, 'rows.jsonl');

  console.log(`${utterances.length} utterances × ${arms.length} arm(s) → ${outDir}`);
  console.log(`cascade endpoint = VAD end + ${CASCADE_HANGOVER_MS}ms, no speculation\n`);

  for (const [index, utterance] of utterances.entries()) {
    const wav = join(HERE, utterance.file);
    const { samples } = readPcm16Wav(wav);
    const vadEnd = speechEndMs(wav);
    if (vadEnd === null) {
      console.log(`${utterance.id}: no speech detected, skipped`);
      continue;
    }

    // Back to back, so nothing that drifts over a run can favour one arm.
    for (const [arm, run] of arms) {
      let row;
      try {
        row = await run(utterance, samples, vadEnd, join(outDir, 'audio'));
      } catch (err) {
        row = {
          ...blankResult(arm, utterance),
          error: String(err),
        };
      }
      // Stamped after the fact, and recorded on every row: a preview model can
      // change under a run, and a table that cannot say when a row was taken
      // cannot defend itself.
      row.at = new Date().toISOString();
      row.model = row.arm === 'live' ? LIVE_MODEL : 'cascade-default';
      appendFileSync(rowsPath, `${JSON.stringify(row)}\n`);
      const latency = row.firstAudioAfterSpeechEndMs;
      console.log(
        `${String(index + 1).padStart(3)}/${utterances.length} ${utterance.id} ${row.arm.padEnd(7)} ` +
          `${row.error ? `ERROR ${row.error}` : `firstAudio=${latency}ms out=${row.outputSpeechMs}ms`}`,
      );
    }
  }

  console.log(`\nrows → ${rowsPath}`);
  console.log('next: node analyze.mjs ' + rowsPath);
}

await main();
