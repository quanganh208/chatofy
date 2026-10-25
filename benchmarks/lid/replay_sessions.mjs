// Replay labelled conversations through the real API, one socket per session.
//
// The offline gate scored what the sidecar's probabilities WOULD show through
// the policy the API runs. This is the same question asked of the API itself:
// each turn is played at wall clock as the web client plays it (100 ms frames,
// the end sent after the speech gate's hangover), and what came back is
// recorded per turn — the mode `server.session.ready` admitted, the first
// language a partial showed and when, the final's language, how long the final
// took after the end, and any error code. `score_replay.py` turns the rows into
// the criteria.
//
// Usage (dev API on :3000, sidecar with identification on, token in a 0600 file):
//   node benchmarks/lid/replay_sessions.mjs --api http://localhost:3000 \
//     --token-file "$TOKEN_FILE" --mode two-way --run-tag p3-two-way
//
// `--token-file a,b` gives worker i the user in file i mod 2; `--concurrent`
// two-way sessions of one user would be the per-user cap at work, not load.
//
// Modes:
//   declared     every turn declares its source (the baseline A7 compares to)
//   two-way      every turn asks for two-way
//   detect       every turn declares no source; the target is the other side
//                of the session's declared pair, so its turns are transcript-only
//   mixed-load   worker 0 runs detect, the others two-way, all at once (A12)
//   adversarial  --concurrent sockets of ONE user open two-way at once; only the
//                admitted mode of each is the result
//
// `--voice` asks for spoken translations, so a load run also loads the TTS engine.
//
// The token is read from --token-file and never printed or put in argv. Rows
// name turns by the public datasets' own ids; nothing here reads production data.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const DEFAULT_MANIFEST = join(RESULTS, 'conv-r4-ctx5', 'manifest.jsonl');

const RATE = 16000;
const CHUNK_MS = 100;
/** `SPEECH_HANGOVER_MS` of the web client's speech gate: silence before it ends a turn. */
const HANGOVER_MS = 500;
/** Longest a turn may take to answer after its end before it is recorded as lost. */
const FINAL_TIMEOUT_MS = 30000;
/** Duplicated from `@chatofy/types`, as `benchmarks/live-translate` does. */
const WS_SUBPROTOCOL = 'chatofy-v1';
const OTHER = { vi: 'en', en: 'vi' };

function parseArgs(argv) {
  const args = {
    api: 'http://localhost:3000',
    tokenFile: null,
    mode: 'two-way',
    concurrent: 1,
    sessions: 10,
    split: false,
    speculate: false,
    voice: false,
    runTag: null,
    manifest: DEFAULT_MANIFEST,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === '--api') args.api = next();
    else if (flag === '--token-file') args.tokenFile = next();
    else if (flag === '--mode') args.mode = next();
    else if (flag === '--concurrent') args.concurrent = Number(next());
    else if (flag === '--sessions') args.sessions = Number(next());
    else if (flag === '--split') args.split = true;
    else if (flag === '--speculate') args.speculate = true;
    else if (flag === '--voice') args.voice = true;
    else if (flag === '--run-tag') args.runTag = next();
    else if (flag === '--manifest') args.manifest = next();
    else if (flag === '--limit') args.limit = Number(next());
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!args.tokenFile) throw new Error('--token-file is required');
  if (!['declared', 'two-way', 'detect', 'mixed-load', 'adversarial'].includes(args.mode)) {
    throw new Error(
      `--mode must be declared, two-way, detect, mixed-load or adversarial, not ${args.mode}`,
    );
  }
  if (!args.runTag && args.limit === null) throw new Error('--run-tag is required');
  return args;
}

/** The token, from a file only its owner can read. */
function readToken(path) {
  const mode = statSync(path).mode & 0o077;
  if (mode !== 0) throw new Error(`${path} is readable by others; chmod 600 it`);
  const token = readFileSync(path, 'utf8').trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}

function readPcm16(path) {
  const buf = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && buf.readUInt32LE(body + 4) !== RATE) {
      throw new Error(`${path}: expected ${RATE} Hz`);
    }
    if (id === 'data') return buf.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

/**
 * The sessions to replay: real vi↔en conversations, half declared vi and half
 * declared en, plus every one-speaker one-language session (A9-mono). Picked
 * by a hash of the session id, so every mode replays the same sessions.
 */
function pickSessions(manifest, perSource) {
  const bySession = new Map();
  for (const line of readFileSync(manifest, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const turn = JSON.parse(line);
    if (!turn.session) continue;
    if (!bySession.has(turn.session)) bySession.set(turn.session, []);
    bySession.get(turn.session).push(turn);
  }
  const rank = (id) => createHash('sha256').update(id).digest('hex');
  const sessions = [...bySession.entries()]
    .map(([id, turns]) => ({ id, turns: turns.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  const languages = (s) => [...new Set(s.turns.map((t) => t.lang))].sort().join('+');
  const picked = [];
  for (const source of ['vi', 'en']) {
    picked.push(
      ...sessions
        .filter((s) => languages(s) === 'en+vi' && s.turns[0].declared_source === source)
        .slice(0, perSource),
    );
  }
  picked.push(...sessions.filter((s) => s.turns[0].mono && ['vi', 'en'].includes(s.turns[0].lang)));
  return picked;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, [WS_SUBPROTOCOL, token]);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${url}`)), { once: true });
  });
}

/** One socket, its events by turn id, and a way to wait on them. */
class Connection {
  constructor(socket) {
    this.socket = socket;
    this.byTurn = new Map();
    this.sessionToTurn = new Map();
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      const turnId = msg.turnId ?? this.sessionToTurn.get(msg.sessionId);
      if (msg.type === 'server.session.ready' && msg.turnId) {
        this.sessionToTurn.set(msg.sessionId, msg.turnId);
      }
      if (!turnId) return;
      if (!this.byTurn.has(turnId)) this.byTurn.set(turnId, []);
      this.byTurn.get(turnId).push({ at: Date.now(), msg });
    });
  }

  send(event, data) {
    this.socket.send(JSON.stringify({ event, data }));
  }

  events(turnId) {
    return this.byTurn.get(turnId) ?? [];
  }

  async waitFor(turnId, test, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.events(turnId).find(({ msg }) => test(msg));
      if (hit) return hit;
      if (Date.now() > deadline) return null;
      await sleep(20);
    }
  }

  close() {
    this.socket.close();
  }
}

/** Play one turn and read back what the API did with it. */
async function playTurn(conn, turn, source, args, mode) {
  const twoWay = mode === 'two-way';
  const turnId = `${turn.id}-${Math.random().toString(36).slice(2, 8)}`;
  conn.send('client.session.start', {
    type: 'client.session.start',
    languagePair: { source: mode === 'detect' ? 'detect' : source, target: OTHER[source] },
    ...(twoWay ? { twoWay: true } : {}),
    voiceGender: 'female',
    // Off unless asked: on, every translated turn also streams speech from the
    // TTS engine, which is the contention a load run must carry.
    voiceOutput: args.voice,
    streamCommitted: true,
    ...(args.split ? { embedSpeaker: true, splitSpeakers: true } : {}),
    turnId,
  });
  const ready = await conn.waitFor(
    turnId,
    (msg) => msg.type === 'server.session.ready' || msg.type === 'server.error',
    10000,
  );
  const row = {
    turn: turn.id,
    session: turn.session,
    lang: turn.lang,
    declared_source: source,
    bucket: turn.bucket,
    speech_ms: turn.speech_ms,
    codeswitch: turn.codeswitch,
    noise: turn.noise,
    mono: turn.mono,
    group: turn.group,
    accent_l1: turn.accent_l1,
    asked: mode,
    ready_mode: null,
    mode_reason: null,
    first_language: null,
    first_language_ms: null,
    partial_languages: [],
    final_language: null,
    final_ms: null,
    error: null,
  };
  if (!ready || ready.msg.type !== 'server.session.ready') {
    row.error = ready ? ready.msg.code : 'no_ready';
    return row;
  }
  row.ready_mode = ready.msg.mode ?? null;
  row.mode_reason = ready.msg.modeReason ?? null;
  const { sessionId } = ready.msg;

  const pcm = readPcm16(join(HERE, turn.audio));
  const bytesPerChunk = (RATE * 2 * CHUNK_MS) / 1000;
  const startedAt = Date.now();
  for (let offset = 0, i = 0; offset < pcm.length; offset += bytesPerChunk, i += 1) {
    conn.send('client.audio.frame', {
      type: 'client.audio.frame',
      frame: {
        sessionId,
        encoding: 'pcm16',
        sampleRate: RATE,
        sequence: i,
        timestamp: Date.now(),
        payload: pcm.subarray(offset, offset + bytesPerChunk).toString('base64'),
      },
    });
    const wait = startedAt + (i + 1) * CHUNK_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  // A real client speculates on the gate's first suspicion of an end, and
  // ends once the hangover has passed with no more speech.
  if (args.speculate)
    conn.send('client.turn.speculate', { type: 'client.turn.speculate', sessionId });
  await sleep(HANGOVER_MS);
  const endedAt = Date.now();
  conn.send('client.session.end', { type: 'client.session.end', sessionId });

  const done = await conn.waitFor(
    turnId,
    (msg) => msg.type === 'server.session.ended',
    FINAL_TIMEOUT_MS,
  );
  for (const { at, msg } of conn.events(turnId)) {
    if (msg.type === 'server.transcript.partial' || msg.type === 'server.transcript.delta') {
      row.partial_languages.push(msg.language ?? null);
      if (msg.language && row.first_language === null) {
        row.first_language = msg.language;
        row.first_language_ms = at - startedAt;
      }
    }
    if (msg.type === 'server.transcript.final' && row.final_language === null) {
      row.final_language = msg.segment.sourceLanguages[0] ?? null;
      row.final_ms = at - endedAt;
    }
    if (msg.type === 'server.error' && row.error === null) row.error = msg.code;
  }
  if (!done && row.error === null) row.error = 'timeout';
  // A turn that never locked shows its language with the final.
  if (row.first_language === null && row.final_language !== null) {
    row.first_language = row.final_language;
    row.first_language_ms = endedAt - startedAt + row.final_ms;
  }
  return row;
}

/** What a worker asks for: in a mixed load the first worker detects. */
function modeFor(mode, worker) {
  if (mode === 'mixed-load') return worker === 0 ? 'detect' : 'two-way';
  return mode;
}

async function replaySession(session, args, out, worker) {
  // Read per socket: an access token lives 15 minutes and a replay runs longer,
  // so whatever keeps the file fresh is picked up by the next session. Each
  // worker is its own user when several token files are given: identification
  // is capped at one socket per user, so a load test needs several users.
  const files = args.tokenFile.split(',');
  const token = readToken(files[worker % files.length]);
  const conn = new Connection(
    await connect(`${args.api.replace(/^http/, 'ws')}/ws/translate`, token),
  );
  try {
    const first = session.turns[0];
    const source = first.declared_source ?? first.lang;
    const turns = args.limit === null ? session.turns : session.turns.slice(0, args.limit);
    for (const turn of turns) {
      const row = await playTurn(conn, turn, source, args, modeFor(args.mode, worker));
      appendFileSync(out, `${JSON.stringify(row)}\n`);
    }
  } finally {
    conn.close();
  }
}

/** Several sockets of one user ask for two-way at once; each one's admitted mode. */
async function adversarial(sessions, args, token, out) {
  const conns = await Promise.all(
    Array.from({ length: args.concurrent }, () =>
      connect(`${args.api.replace(/^http/, 'ws')}/ws/translate`, token).then(
        (s) => new Connection(s),
      ),
    ),
  );
  try {
    const rows = await Promise.all(
      conns.map((conn, index) => {
        const session = sessions[index % sessions.length];
        const turn = session.turns[0];
        return playTurn(conn, turn, turn.declared_source ?? turn.lang, args, 'two-way').then(
          (row) => ({
            ...row,
            socket: index,
          }),
        );
      }),
    );
    for (const row of rows) appendFileSync(out, `${JSON.stringify(row)}\n`);
  } finally {
    for (const conn of conns) conn.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.limit === null ? join(RESULTS, args.runTag) : join(RESULTS, 'smoke');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'replay.jsonl');
  writeFileSync(out, '');
  const sessions = pickSessions(args.manifest, args.sessions);
  writeFileSync(
    join(dir, 'replay.json'),
    `${JSON.stringify(
      {
        mode: args.mode,
        concurrent: args.concurrent,
        split: args.split,
        speculate: args.speculate,
        voice: args.voice,
        sessions: sessions.map((s) => s.id),
        manifest: args.manifest,
        started: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  if (args.mode === 'adversarial') {
    await adversarial(sessions, args, readToken(args.tokenFile.split(',')[0]), out);
  } else {
    // `--concurrent` sessions at once, each on its own socket.
    const queue = [...sessions];
    await Promise.all(
      Array.from({ length: args.concurrent }, async (_, worker) => {
        for (let session = queue.shift(); session; session = queue.shift()) {
          await replaySession(session, args, out, worker);
          console.log(`session ${session.id} done (${queue.length} left)`);
        }
      }),
    );
  }
  console.log(`rows in ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
