// Replay recorded conversations through the API exactly as the web client
// would send them, with voice on or off, and record one row per turn for the
// latency analysis.
//
//   cd apps/api && npx tsx ../../benchmarks/latency/replay-latency.mts \
//     --api http://127.0.0.1:4000 --token-file "$SCRATCHPAD/owner-token" \
//     --voice on --run-tag baseline-voice
//
// A copy of `benchmarks/call-budget/replay-recordings.mts` with the one switch
// the latency tables need: `--voice on|off`. The two latencies a reader can
// wait on are different: with voice off it is the final LINE (`lineSent`),
// with voice on it is the first AUDIO, and a latency table has to be built
// from a run that asked for the one it reports.
//
// Everything else is the original's, and for the same reasons: the audio goes
// through the SHIPPED client — `ConversationSession` fed through
// `pushedCaptureDeps`, with `CASCADE_RUNTIME_OPTIONS` — started with the
// options the web page sends (`repairDisplay`, `embedSpeaker`, `splitSpeakers`
// on), so the speculate timing the server sees is the client's real one. With
// voice on, playback still goes to a silent sink: the server's timeline ends
// at the frame it pushed, so nothing has to be heard.
//
// One socket per recording, played at wall clock in 1024-sample blocks.
// Turns are recorded in `results/<run-tag>/rows.jsonl` without any text: the
// server's session id, the turn's source language, timings and outcome. The
// direction is decided per turn on a two-way start, and the API's turn line
// does not carry it, so `analyze-latency.mjs` joins the two on the session id.
//
// The token is read from a 0600 file and never printed or put in argv.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerEvent, SessionOptions } from '../../packages/types/src/index';

import type { PlaybackSink } from '../../packages/realtime-client/src/audio/ordered-playback';
import { pushedCaptureDeps } from '../../packages/realtime-client/src/audio/pushed-pcm-capture';
import { CASCADE_RUNTIME_OPTIONS } from '../../packages/realtime-client/src/conversation/cascade-runtime-options';
import { ConversationSession } from '../../packages/realtime-client/src/conversation/conversation-session';
import {
  blocksToRetranslate,
  groupTurnsForDisplay,
} from '../../packages/realtime-client/src/state/display-groups';
import {
  blockKey,
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
} from '../../packages/realtime-client/src/state/turn-keyed-transcript';
import {
  TranslateSocket,
  translateSocketUrl,
} from '../../packages/realtime-client/src/transport/translate-socket';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONVERSATIONS = join(HERE, '..', 'speaker-id', 'rulers', 'conversations');
/** What the browser's audio worklet posts per message. */
const WORKLET_BLOCK_SAMPLES = 1024;
/** Room tone after the recording, so the gate can close the last turn. */
const TRAILING_SILENCE_MS = 2_000;
/** How long the last turns may take to answer once the audio has ended. */
const DRAIN_TIMEOUT_MS = 60_000;

const HELP = `Usage: npx tsx ../../benchmarks/latency/replay-latency.mts [flags]   (run from apps/api)

  --api <url>                 API base URL (default http://127.0.0.1:4000)
  --token-file <path>         0600 file holding the access token (required)
  --run-tag <tag>             results/<tag>/rows.jsonl is written (required)
  --voice on|off              ask the server for speech or not (default on)
  --conversations-dir <dir>   where the .wav + .turns.tsv pairs are
                              (default benchmarks/speaker-id/rulers/conversations)
  --ids <id,id,...>           recordings to play, in order (default: every pair)
  --one-way <src:tgt,...>     one declared pair per id in --ids, instead of the
                              two-way start with speaker split
  --help                      print this and exit`;

interface Args {
  api: string;
  tokenFile: string;
  ids: string[] | null;
  runTag: string;
  /** Where the WAVs are; the speaker-id ruler's folder unless named. */
  dir: string;
  /** `source:target` per id: a declared one-way start, as a meeting leg makes. */
  oneWay: Pair[] | null;
  /** Whether the session asks for speech. */
  voice: boolean;
}

interface Pair {
  source: string;
  target: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    api: 'http://127.0.0.1:4000',
    tokenFile: '',
    ids: null,
    runTag: '',
    dir: CONVERSATIONS,
    oneWay: null,
    voice: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (flag === '--api') args.api = next();
    else if (flag === '--voice') {
      const value = next();
      if (value !== 'on' && value !== 'off')
        throw new Error(`--voice wants on or off, got ${value}`);
      args.voice = value === 'on';
    } else if (flag === '--token-file') args.tokenFile = next();
    else if (flag === '--ids') args.ids = next().split(',').filter(Boolean);
    else if (flag === '--run-tag') args.runTag = next();
    else if (flag === '--conversations-dir') args.dir = next();
    else if (flag === '--one-way') {
      args.oneWay = next()
        .split(',')
        .map((pair) => {
          const [source, target] = pair.split(':');
          if (!source || !target) throw new Error(`--one-way wants source:target, got ${pair}`);
          return { source, target };
        });
    } else throw new Error(`unknown flag ${flag}; --help lists them`);
  }
  if (!args.tokenFile) throw new Error('--token-file is required');
  if (!args.runTag) throw new Error('--run-tag is required');
  if (args.oneWay && args.oneWay.length !== args.ids?.length) {
    throw new Error('--one-way needs one pair per id in --ids');
  }
  return args;
}

function readToken(path: string): string {
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error(`${path} is readable by others; chmod 600 it`);
  const token = readFileSync(path, 'utf8').trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}

/** Every recording in `dir` that has a turn list beside it, by id. */
function recordingIds(dir: string): string[] {
  const names = readdirSync(dir);
  return names
    .filter((name) => name.endsWith('.turns.tsv'))
    .map((name) => name.slice(0, -'.turns.tsv'.length))
    .filter((id) => names.includes(`${id}.wav`))
    .sort();
}

/** Mono 16-bit PCM WAV as floats, with its rate. */
function readWav(path: string): { samples: Float32Array; rate: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path} is not a RIFF file`);
  let rate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (buffer.readUInt16LE(body + 2) !== 1) throw new Error(`${path}: expected mono`);
      rate = buffer.readUInt32LE(body + 4);
    }
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i += 1)
        samples[i] = buffer.readInt16LE(body + i * 2) / 0x8000;
      return { samples, rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

/** Room tone the gate reads as silence; deterministic so a rerun hears the same thing. */
function roomTone(sampleCount: number): Float32Array {
  const tone = new Float32Array(sampleCount);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < sampleCount; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    tone[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.002;
  }
  return tone;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Row {
  recording: string;
  turnId: string;
  /** The server's id for the turn, which its `TurnMetricsRecorder` line carries. */
  sessionId: string | null;
  /** The language the turn was heard in, from its final; null when none came. */
  language: string | null;
  /** Whether the server split the turn between two voices. */
  split: boolean;
  /** Whether the session asked for speech. */
  voice: boolean;
  index: number;
  startedAtMs: number;
  /** Where in the recording the turn opened. */
  mediaMs: number;
  readyMs: number | null;
  closedMs: number | null;
  closeReason: string | null;
  error: string | null;
}

/** Speech, when asked for, is measured on the server; the sink drops it. */
const silentSink = (): PlaybackSink => ({
  enqueue: () => undefined,
  isPlayingTurn: () => false,
  isPlaying: false,
  stop: () => undefined,
  stopTurn: () => undefined,
});

async function replayRecording(
  id: string,
  args: Args,
  out: string,
  pair: Pair | undefined,
): Promise<number> {
  const { samples, rate } = readWav(join(args.dir, `${id}.wav`));
  const token = readToken(args.tokenFile);
  const rows = new Map<string, Row>();
  const byServerId = new Map<string, string>();
  const started = Date.now();
  /** How far into the recording the audio has been played. */
  let playedSamples = 0;

  // The page's transcript state, so blocks are asked for exactly when it would ask.
  let transcript = initialTurnKeyedTranscript;
  const askedBlocks = new Set<string>();
  let session: ConversationSession | null = null;
  const dispatch = (action: TurnKeyedAction) => {
    transcript = turnKeyedTranscriptReducer(transcript, action);
    const groups = groupTurnsForDisplay(
      transcript.turns,
      transcript.captures,
      transcript.attributions,
    );
    for (const segmentIds of blocksToRetranslate(groups, transcript.blockTranslations)) {
      const key = blockKey(segmentIds);
      if (askedBlocks.has(key)) continue;
      askedBlocks.add(key);
      session?.retranslateBlock(segmentIds);
    }
  };

  // Records the moment each turn's start leaves the socket: one row per
  // `session.start` the server will log.
  class RecordingSocket extends TranslateSocket {
    override startSession(options: SessionOptions, turnId: string): void {
      rows.set(turnId, {
        recording: id,
        turnId,
        sessionId: null,
        language: null,
        split: false,
        voice: args.voice,
        index: rows.size,
        mediaMs: Math.round((playedSamples / rate) * 1000),
        startedAtMs: Date.now() - started,
        readyMs: null,
        closedMs: null,
        closeReason: null,
        error: null,
      });
      super.startSession(options, turnId);
    }
  }

  const track = (event: ServerEvent) => {
    // A split piece's final is keyed `<parent>#<index>`; it belongs to its parent's row.
    const serverId =
      'sessionId' in event && typeof event.sessionId === 'string'
        ? event.sessionId.split('#')[0]!
        : undefined;
    const turnId =
      ('turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined) ??
      (serverId === undefined ? undefined : byServerId.get(serverId));
    const row = turnId ? rows.get(turnId) : undefined;
    if (!row) return;
    if (event.type === 'server.session.ready') {
      byServerId.set(event.sessionId, row.turnId);
      row.sessionId = event.sessionId;
      row.readyMs = Date.now() - started;
    } else if (event.type === 'server.session.ended') {
      row.closedMs = Date.now() - started;
      row.closeReason = event.reason;
    } else if (event.type === 'server.error' && row.error === null) {
      row.error = event.code;
    } else if (event.type === 'server.transcript.final') {
      // The first piece's language is the turn's: a split turn is decided once.
      row.language ??= pair?.source ?? event.segment.sourceLanguage;
      if (event.split) row.split = true;
    }
  };

  // The audio, played at the browser worklet's pace once the session opens it.
  let feeding: Promise<void> = Promise.resolve();
  const source = {
    start: async (onBuffer: (block: Float32Array, sampleRate: number) => void) => {
      const tail = roomTone(Math.round((rate * TRAILING_SILENCE_MS) / 1000));
      const audio = new Float32Array(samples.length + tail.length);
      audio.set(samples);
      audio.set(tail, samples.length);
      const blockMs = (WORKLET_BLOCK_SAMPLES / rate) * 1000;
      feeding = (async () => {
        const playStart = Date.now();
        for (
          let offset = 0, i = 0;
          offset < audio.length;
          offset += WORKLET_BLOCK_SAMPLES, i += 1
        ) {
          onBuffer(audio.slice(offset, offset + WORKLET_BLOCK_SAMPLES), rate);
          playedSamples = offset;
          const wait = playStart + (i + 1) * blockMs - Date.now();
          if (wait > 0) await sleep(wait);
        }
      })();
    },
    stop: async () => undefined,
  };

  let stopped!: () => void;
  const ended = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  session = new ConversationSession(
    {
      ...pushedCaptureDeps(source),
      createSocket: (handlers) =>
        new RecordingSocket(translateSocketUrl(args.api), handlers, token),
      createPlaybackSink: () => silentSink(),
    },
    {
      onStatus: () => undefined,
      onLevel: () => undefined,
      onMuted: () => undefined,
      onError: (message) => {
        if (message) console.error(`${id}: ${message}`);
      },
      onEchoHeard: () => undefined,
      onServerEvent: (event) => {
        track(event);
        dispatch(event as TurnKeyedAction);
      },
      onReset: () => dispatch({ type: 'transcript.reset' }),
      onTurnAbandoned: (sessionId, reason) =>
        dispatch({ type: 'transcript.turnAbandoned', sessionId: sessionId ?? undefined, reason }),
      onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt, preRollMs }) =>
        dispatch({
          type: 'transcript.turnCaptureRecorded',
          sessionId,
          cutForced,
          openedAt,
          closedAt,
          preRollMs,
        }),
      onDrained: () => dispatch({ type: 'transcript.settled' }),
      onStopped: () => stopped(),
      onLog: (message) => console.error(`${id}: ${message}`),
    },
    () => CASCADE_RUNTIME_OPTIONS,
  );

  // What the page starts a vi↔en two-way conversation with (`cascade-panel.tsx`
  // and `use-streaming-translate.ts`), with voice as asked and no AI context.
  // `--one-way` is the same start without the identifying and the speaker
  // split a meeting leg never asks for, so the two compare one pipeline.
  await session.start({
    languagePair: pair ?? { source: 'vi', target: 'en' },
    ...(pair ? {} : { twoWay: true, embedSpeaker: true, splitSpeakers: true }),
    voiceGender: 'female',
    voiceOutput: args.voice,
    speed: 1,
    repairDisplay: true,
    streamCommitted: true,
  } as SessionOptions);
  await feeding;
  // End as the End button does: the open turn closes and the tail drains,
  // with block answers given their grace, before the session stops itself.
  session.finish();
  await Promise.race([ended, sleep(DRAIN_TIMEOUT_MS)]);
  session.stop();

  for (const row of rows.values()) {
    if (row.closedMs === null && row.error === null) row.error = 'timeout';
    appendFileSync(out, `${JSON.stringify(row)}\n`);
  }
  console.log(`${id} blocks-asked=${askedBlocks.size}`);
  return rows.size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = join(HERE, 'results', args.runTag);
  const out = join(dir, 'rows.jsonl');
  // Rows are appended per recording, so a second run under the same tag would
  // silently mix two runs into one table. Checked before anything else runs.
  if (existsSync(out)) {
    console.error(`${out} already exists; pick a new --run-tag or remove that run first`);
    process.exit(1);
  }
  const ids = args.ids ?? recordingIds(args.dir);
  mkdirSync(dir, { recursive: true });
  const windowStart = new Date().toISOString();
  console.log(`window-start=${windowStart} voice=${args.voice ? 'on' : 'off'}`);
  let turns = 0;
  for (const [index, id] of ids.entries()) {
    const sent = await replayRecording(id, args, out, args.oneWay?.[index]);
    turns += sent;
    console.log(`${id} turns=${sent}`);
  }
  // A moment for the last turns' log lines to be written before the window closes.
  await sleep(2_000);
  const windowEnd = new Date().toISOString();
  console.log(`window-end=${windowEnd}`);
  console.log(`recordings=${ids.length} turns=${turns}`);
  // The window beside the rows, so the log for it can be fetched later
  // (see README) without the console output of this run.
  writeFileSync(
    join(dir, 'window.json'),
    `${JSON.stringify({ windowStart, windowEnd, voice: args.voice, ids, turns })}\n`,
  );
  // A refused or dropped socket can leave a reconnect timer behind; the run is over.
  process.exit(0);
}

await main();
