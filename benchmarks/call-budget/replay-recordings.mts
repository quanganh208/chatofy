// Replay recorded conversations through the API exactly as the web client
// would send them, and print the log window the replay occupied.
//
//   cd apps/api && npx tsx ../../benchmarks/call-budget/replay-recordings.mts \
//     --api http://127.0.0.1:4000 --token-file "$SCRATCHPAD/owner-token" --run-tag baseline-1
//
// The audio goes through the SHIPPED client, not a copy of it. That is the
// `ConversationSession` `/translate` runs, fed through `pushedCaptureDeps`, the
// capture path the mobile app uses, with `CASCADE_RUNTIME_OPTIONS`. It is
// started with the options the web page sends (`cascade-panel.tsx`):
// `repairDisplay`, `embedSpeaker` and `splitSpeakers` on, so the server runs the
// transcript checks and the speaker split it runs for a real user. Server events
// and capture records go through the client's own `turnKeyedTranscriptReducer`.
// After each one, the blocks `blocksToRetranslate` names are asked for once, as
// `use-streaming-translate.ts` does. So the calls a replay costs are the calls a
// person speaking these recordings into `/translate` would have cost.
//
// Voice is off, as the owner runs it on prod (`turn … ok (voice_off)` in the
// log), and playback goes to a silent sink.
//
// One socket per recording, played at wall clock in 1024-sample blocks at
// 48 kHz, as the browser's worklet delivers them. Turns are recorded in
// `results/<run-tag>/rows.jsonl` without any text: id, timings and outcome.
// Then `analyze.mjs` reads the API log between the two window lines.
//
// The token is read from a 0600 file and never printed or put in argv.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

interface Args {
  api: string;
  tokenFile: string;
  ids: string[] | null;
  runTag: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { api: 'http://127.0.0.1:4000', tokenFile: '', ids: null, runTag: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--api') args.api = next();
    else if (flag === '--token-file') args.tokenFile = next();
    else if (flag === '--ids') args.ids = next().split(',').filter(Boolean);
    else if (flag === '--run-tag') args.runTag = next();
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!args.tokenFile) throw new Error('--token-file is required');
  if (!args.runTag) throw new Error('--run-tag is required');
  return args;
}

function readToken(path: string): string {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${path} is readable by others; chmod 600 it`);
  const token = readFileSync(path, 'utf8').trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}

/** Every recording that has a turn list beside it, by id. */
function recordingIds(): string[] {
  return readdirSync(CONVERSATIONS)
    .filter((name) => name.endsWith('.turns.tsv'))
    .map((name) => name.slice(0, -'.turns.tsv'.length))
    .filter((id) => readdirSync(CONVERSATIONS).includes(`${id}.wav`))
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
      for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(body + i * 2) / 0x8000;
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
  index: number;
  startedAtMs: number;
  readyMs: number | null;
  closedMs: number | null;
  closeReason: string | null;
  error: string | null;
}

/** Nothing is spoken: voice is off, so a sink that drops what it is given. */
const silentSink = (): PlaybackSink => ({
  enqueue: () => undefined,
  isPlayingTurn: () => false,
  isPlaying: false,
  stop: () => undefined,
  stopTurn: () => undefined,
});

async function replayRecording(id: string, args: Args, out: string): Promise<number> {
  const { samples, rate } = readWav(join(CONVERSATIONS, `${id}.wav`));
  const token = readToken(args.tokenFile);
  const rows = new Map<string, Row>();
  const byServerId = new Map<string, string>();
  const started = Date.now();

  // The page's transcript state, so blocks are asked for exactly when it would ask.
  let transcript = initialTurnKeyedTranscript;
  const askedBlocks = new Set<string>();
  let session: ConversationSession | null = null;
  const dispatch = (action: TurnKeyedAction) => {
    transcript = turnKeyedTranscriptReducer(transcript, action);
    const groups = groupTurnsForDisplay(transcript.turns, transcript.captures, transcript.attributions);
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
        index: rows.size,
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
    const turnId =
      ('turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined) ??
      ('sessionId' in event && typeof event.sessionId === 'string' ? byServerId.get(event.sessionId) : undefined);
    const row = turnId ? rows.get(turnId) : undefined;
    if (!row) return;
    if (event.type === 'server.session.ready') {
      byServerId.set(event.sessionId, row.turnId);
      row.readyMs = Date.now() - started;
    } else if (event.type === 'server.session.ended') {
      row.closedMs = Date.now() - started;
      row.closeReason = event.reason;
    } else if (event.type === 'server.error' && row.error === null) {
      row.error = event.code;
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
        for (let offset = 0, i = 0; offset < audio.length; offset += WORKLET_BLOCK_SAMPLES, i += 1) {
          onBuffer(audio.slice(offset, offset + WORKLET_BLOCK_SAMPLES), rate);
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
      createSocket: (handlers) => new RecordingSocket(translateSocketUrl(args.api), handlers, token),
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
        dispatch({ type: 'transcript.turnCaptureRecorded', sessionId, cutForced, openedAt, closedAt, preRollMs }),
      onDrained: () => dispatch({ type: 'transcript.settled' }),
      onStopped: () => stopped(),
      onLog: (message) => console.error(`${id}: ${message}`),
    },
    () => CASCADE_RUNTIME_OPTIONS,
  );

  // What the page starts a vi↔en two-way conversation with (`cascade-panel.tsx`
  // and `use-streaming-translate.ts`), with voice off and no AI context.
  await session.start({
    languagePair: { source: 'vi', target: 'en' },
    twoWay: true,
    voiceGender: 'female',
    voiceOutput: false,
    speed: 1,
    embedSpeaker: true,
    splitSpeakers: true,
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
  const ids = args.ids ?? recordingIds();
  const dir = join(HERE, 'results', args.runTag);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'rows.jsonl');
  console.log(`window-start=${new Date().toISOString()}`);
  let turns = 0;
  for (const id of ids) {
    const sent = await replayRecording(id, args, out);
    turns += sent;
    console.log(`${id} turns=${sent}`);
  }
  // A moment for the last turns' log lines to be written before the window closes.
  await sleep(2_000);
  console.log(`window-end=${new Date().toISOString()}`);
  console.log(`recordings=${ids.length} turns=${turns}`);
  // A refused or dropped socket can leave a reconnect timer behind; the run is over.
  process.exit(0);
}

await main();
