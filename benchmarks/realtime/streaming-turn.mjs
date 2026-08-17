// Plays one long fixture through /ws/translate as a STREAMING turn and reports
// what the listener would have experienced while the speaker was still talking.
//
// This exists because the three open questions about the streaming path are all
// about the middle of a turn, and every tool already here looks at its end:
// `run-arms.mjs` compares whole-utterance latency between systems, and
// `analyze-continuous.mjs` reads a metrics file after the fact. Neither answers
// "did the translation ever go quiet for nine seconds", because nothing records
// when each commit arrived.
//
// It measures at RECEIPT, in this process, for the same reason `run-arms.mjs`
// does: the server's own rows are telemetry written by the thing under test.
// A commit is counted when it lands here, which is also the first moment a real
// client could have played it.
//
//   commit gap   — longest silence between two commits, and from turn start to
//                  the first one. This is the "translation dies mid-sentence"
//                  failure, and it is invisible to latency percentiles: a turn
//                  that commits nothing scores no bad latency at all.
//   first commit — ms after the turn OPENED, not after the endpoint. The claim
//                  the feature makes is that this stops growing with length.
//   cpu          — utime+stime deltas from /proc for the API and the sidecar,
//                  sampled here so the same command produces the before and
//                  after numbers. Linux only; skipped with a note elsewhere.
//
// Contradicted commits are NOT measured here and cannot be: only the server
// sees a later read disagree with text it already spoke. Read
// `commitContradictions` from the TURN_METRICS_PATH row for this session id.
//
// Usage:
//   node benchmarks/realtime/streaming-turn.mjs fixtures/vlsp-vi-01.wav --lang vi
//   node benchmarks/realtime/streaming-turn.mjs fixtures/vlsp-vi-01.wav --cpu-pid 1234 --cpu-pid 5678
//   node benchmarks/realtime/streaming-turn.mjs fixtures/vlsp-vi-01.wav --json run.json
//
// Needs the API on :3000 with TURN_METRICS_PATH set, plus both sidecars.

import { readFileSync, writeFileSync } from 'node:fs';
import { openWav } from './wav.mjs';

const CHUNK_MS = 100;

/**
 * How long to keep listening after the endpoint is declared.
 *
 * A streaming turn has already spoken most of itself by here; what is still
 * owed is the uncommitted tail. Generous because a tail that arrives late is a
 * finding, and a driver that stopped listening first would record it as absent.
 */
const DRAIN_MS = 40000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** utime+stime for a pid, in seconds. Null when the process is gone. */
function cpuSeconds(pid) {
  let stat;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  // The comm field is parenthesised and may itself contain spaces, so fields
  // are counted from the closing paren rather than by splitting the whole line.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const ticks = Number(fields[11]) + Number(fields[12]);
  return ticks / 100;
}

function parseArgs(argv) {
  const args = {
    file: null,
    lang: 'vi',
    api: 'http://localhost:3000',
    cpuPids: [],
    json: null,
    streaming: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang') args.lang = argv[++i];
    else if (arg === '--api') args.api = argv[++i];
    else if (arg === '--cpu-pid') args.cpuPids.push(Number(argv[++i]));
    else if (arg === '--json') args.json = argv[++i];
    else if (arg === '--no-streaming') args.streaming = false;
    else if (!arg.startsWith('--')) args.file = arg;
  }
  if (!args.file) throw new Error('usage: streaming-turn.mjs <file.wav> [--lang vi]');
  return args;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${url}`)), {
      once: true,
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const direction = args.lang === 'vi' ? 'vi_to_en' : 'en_to_vi';
  const { sampleRate, pcm: samples } = openWav(readFileSync(args.file));

  const wsBase = args.api.replace(/^http/, 'ws');
  const socket = await connect(`${wsBase}/ws/translate`);

  let sessionId = null;
  let ended = false;
  let error = null;
  const commits = [];
  const audioAt = [];
  let transcriptSource = '';
  let transcriptTarget = '';

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === 'server.session.ready') sessionId = msg.sessionId;
    else if (msg.type === 'server.translation.commit')
      commits.push({ at: Date.now(), seq: msg.seq, text: msg.text });
    else if (msg.type === 'server.audio.frame') audioAt.push(Date.now());
    else if (msg.type === 'server.transcript.final') {
      transcriptSource = msg.segment?.sourceText ?? '';
      transcriptTarget = msg.segment?.targetText ?? '';
    } else if (msg.type === 'server.session.ended') ended = true;
    else if (msg.type === 'server.error') error = `${msg.code}: ${msg.message}`;
  });

  const send = (event, data) => socket.send(JSON.stringify({ event, data }));
  send('client.session.start', {
    type: 'client.session.start',
    direction,
    voiceGender: 'female',
    streaming: args.streaming,
  });

  const readyDeadline = Date.now() + 15000;
  while (sessionId === null && Date.now() < readyDeadline) await sleep(20);
  if (sessionId === null) {
    socket.close();
    throw new Error(error ?? 'never received server.session.ready');
  }

  const cpuBefore = args.cpuPids.map((pid) => ({ pid, seconds: cpuSeconds(pid) }));
  const bytesPerChunk = (sampleRate * 2 * CHUNK_MS) / 1000;
  // The turn OPENS here, and every reported mark is relative to this instant:
  // first-commit latency measured from the endpoint would hide the entire claim,
  // because on a streaming turn the first commit happens long before it.
  const startedAt = Date.now();

  for (let offset = 0, i = 0; offset < samples.length; offset += bytesPerChunk, i += 1) {
    send('client.audio.frame', {
      type: 'client.audio.frame',
      frame: {
        sessionId,
        encoding: 'pcm16',
        sampleRate,
        sequence: i,
        timestamp: Date.now(),
        payload: samples.subarray(offset, offset + bytesPerChunk).toString('base64'),
      },
    });
    // Paced at wall clock. Feeding faster than real time would make every
    // interval here fiction, and the gaps are the whole measurement.
    const wait = startedAt + (i + 1) * CHUNK_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  const spokeUntil = Date.now();
  send('client.session.end', { type: 'client.session.end', sessionId });

  const deadline = Date.now() + DRAIN_MS;
  while (Date.now() < deadline && !ended) await sleep(100);
  const finishedAt = Date.now();
  const cpuAfter = args.cpuPids.map((pid) => ({ pid, seconds: cpuSeconds(pid) }));
  socket.close();

  // Gaps are capped at when the speaker stopped: silence after the endpoint is
  // the ordinary tail, not the failure this looks for.
  const marks = commits.map((c) => c.at).sort((a, b) => a - b);
  const gaps = [];
  let previous = startedAt;
  for (const mark of marks) {
    gaps.push(mark - previous);
    previous = mark;
  }
  if (marks.length > 0 && spokeUntil > previous) gaps.push(spokeUntil - previous);
  if (marks.length === 0) gaps.push(spokeUntil - startedAt);

  const audioSeconds = samples.length / 2 / sampleRate;
  const cpu = args.cpuPids.map((pid, i) => {
    const before = cpuBefore[i]?.seconds;
    const after = cpuAfter[i]?.seconds;
    const seconds = before === null || after === null ? null : Number((after - before).toFixed(2));
    return {
      pid,
      seconds,
      cores: seconds === null ? null : Number((seconds / audioSeconds).toFixed(2)),
    };
  });

  const result = {
    file: args.file,
    lang: args.lang,
    streaming: args.streaming,
    sessionId,
    error,
    audioSeconds: Number(audioSeconds.toFixed(2)),
    commits: commits.map((c) => ({ seq: c.seq, atMs: c.at - startedAt, text: c.text })),
    firstCommitAfterStartMs: marks.length ? marks[0] - startedAt : null,
    worstCommitGapMs: Math.max(...gaps),
    firstAudioAfterStartMs: audioAt.length ? Math.min(...audioAt) - startedAt : null,
    audioFrames: audioAt.length,
    turnMs: finishedAt - startedAt,
    transcriptSource,
    transcriptTarget,
    cpu,
  };

  console.log(`session      ${sessionId}`);
  console.log(`audio        ${result.audioSeconds}s, turn ran ${result.turnMs}ms`);
  console.log(`commits      ${commits.length}`);
  console.log(`first commit ${result.firstCommitAfterStartMs ?? '—'}ms after turn start`);
  console.log(`first audio  ${result.firstAudioAfterStartMs ?? '—'}ms after turn start`);
  console.log(`worst gap    ${result.worstCommitGapMs}ms between commits`);
  for (const entry of cpu) {
    console.log(
      `cpu pid ${entry.pid}  ${entry.seconds ?? '—'}s  (${entry.cores ?? '—'} cores sustained)`,
    );
  }
  if (error) console.log(`error        ${error}`);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify(result, null, 2));
    console.log(`\nwrote ${args.json}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
