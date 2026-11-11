// Replay one recorded conversation through the API, cut the client's socket
// partway through, and count what survived.
//
//   cd apps/api && npx tsx ../../benchmarks/socket-drop/replay-with-forced-drop.mts \
//     --api 127.0.0.1:4000 --token-file "$SCRATCHPAD/owner-token" --id <recording> \
//     --one-way en:vi --drop-at-ms 60000
//
// The shape it reproduces is the 2026-11-11 prod drop: the browser's socket
// died, but the API's end of it stayed open, so the server never learned the
// conversation was gone. A TCP proxy on 127.0.0.1:4100 sits between the client
// and the API. At `--drop-at-ms` it destroys the client side of the live
// connection and deliberately keeps the upstream side open and read. Every
// later connection (the reconnect) passes through untouched.
//
// The client is the SHIPPED `ConversationSession`, fed through
// `pushedCaptureDeps` at wall clock, with `reconnectOnDrop` on as the web page
// runs it (`--no-reconnect` turns it off, to watch the server heartbeat free a
// half-open socket on its own). Voice is off; server events go through the
// page's own transcript reducer, so `turns=` is the number of rows history
// would save.
//
// Prints counts only, never text. The token is read from a 0600 file and never
// printed or put in argv. Run the same recording with `--drop-at-ms 0` for the
// baseline.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerEvent, SessionOptions } from '../../packages/types/src/index';
import type { PlaybackSink } from '../../packages/realtime-client/src/audio/ordered-playback';
import { pushedCaptureDeps } from '../../packages/realtime-client/src/audio/pushed-pcm-capture';
import { CASCADE_RUNTIME_OPTIONS } from '../../packages/realtime-client/src/conversation/cascade-runtime-options';
import { ConversationSession } from '../../packages/realtime-client/src/conversation/conversation-session';
import type { ConversationStatus } from '../../packages/realtime-client/src/conversation/conversation-status';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
} from '../../packages/realtime-client/src/state/turn-keyed-transcript';
import { TranslateSocket, translateSocketUrl } from '../../packages/realtime-client/src/transport/translate-socket';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONVERSATIONS = join(HERE, '..', 'speaker-id', 'rulers', 'conversations');
const PROXY_PORT = 4100;
const WORKLET_BLOCK_SAMPLES = 1024;
const TRAILING_SILENCE_MS = 2_000;
const DRAIN_TIMEOUT_MS = 60_000;

const USAGE = `usage: replay-with-forced-drop.mts --token-file <0600 file> [options]
  --api <host:port>      API to proxy to (default 127.0.0.1:4000)
  --id <recording>       recording id in ${CONVERSATIONS} (default: the first)
  --one-way <src:tgt>    declared one-way pair (default en:vi, the 2026-11-11 shape)
  --drop-at-ms <ms>      cut the client leg this long after the first audio; 0 = no drop (default 60000)
  --no-reconnect         leave reconnectOnDrop off, to watch the server heartbeat
  --help                 print this and exit`;

interface Args {
  api: { host: string; port: number };
  tokenFile: string;
  id: string | null;
  pair: { source: string; target: string };
  dropAtMs: number;
  reconnect: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = {
    api: { host: '127.0.0.1', port: 4000 },
    tokenFile: '',
    id: null,
    pair: { source: 'en', target: 'vi' },
    dropAtMs: 60_000,
    reconnect: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--help') return null;
    else if (flag === '--api') {
      const [host, port] = next().split(':');
      args.api = { host: host || '127.0.0.1', port: Number(port) || 4000 };
    } else if (flag === '--token-file') args.tokenFile = next();
    else if (flag === '--id') args.id = next();
    else if (flag === '--one-way') {
      const [source, target] = next().split(':');
      if (!source || !target) throw new Error('--one-way wants source:target');
      args.pair = { source, target };
    } else if (flag === '--drop-at-ms') args.dropAtMs = Number(next());
    else if (flag === '--no-reconnect') args.reconnect = false;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!args.tokenFile) throw new Error('--token-file is required');
  return args;
}

function readToken(path: string): string {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${path} is readable by others; chmod 600 it`);
  const token = readFileSync(path, 'utf8').trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}

/** Mono 16-bit PCM WAV as floats, with its rate. */
function readWav(path: string): { samples: Float32Array; rate: number } {
  const buffer = readFileSync(path);
  let rate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') rate = buffer.readUInt32LE(body + 4);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(body + i * 2) / 0x8000;
      return { samples, rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A TCP relay that can kill the client leg of its live connection while the
 * upstream leg stays open: what the API saw on 2026-11-11.
 */
function startProxy(upstreamAt: Args['api']) {
  const pairs: { client: Socket; upstream: Socket; halfOpen: boolean }[] = [];
  const kept: Socket[] = [];
  const server = createServer((client) => {
    const upstream = connect(upstreamAt.port, upstreamAt.host);
    const pair = { client, upstream, halfOpen: false };
    pairs.push(pair);
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('close', () => {
      if (!pair.halfOpen) upstream.destroy();
    });
    upstream.on('close', () => client.destroy());
  });
  server.listen(PROXY_PORT, '127.0.0.1');
  return {
    connections: () => pairs.length,
    /** Cut the newest connection's client leg; keep its upstream open and drained. */
    dropClientLeg: () => {
      const pair = pairs.at(-1);
      if (!pair || pair.halfOpen) return false;
      pair.halfOpen = true;
      pair.upstream.unpipe(pair.client);
      pair.client.unpipe(pair.upstream);
      pair.upstream.on('data', () => undefined);
      kept.push(pair.upstream);
      pair.client.destroy();
      return true;
    },
    close: () => {
      for (const socket of kept) socket.destroy();
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      server.close();
    },
  };
}

const silentSink = (): PlaybackSink => ({
  enqueue: () => undefined,
  isPlayingTurn: () => false,
  isPlaying: false,
  stop: () => undefined,
  stopTurn: () => undefined,
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(USAGE);
    return;
  }
  const ids = readdirSync(CONVERSATIONS)
    .filter((name) => name.endsWith('.wav'))
    .map((name) => name.slice(0, -'.wav'.length))
    .sort();
  const id = args.id ?? ids[0];
  if (!id) throw new Error(`no recordings in ${CONVERSATIONS}`);
  const { samples, rate } = readWav(join(CONVERSATIONS, `${id}.wav`));
  const token = readToken(args.tokenFile);
  const proxy = startProxy(args.api);

  let transcript = initialTurnKeyedTranscript;
  const dispatch = (action: TurnKeyedAction) => {
    transcript = turnKeyedTranscriptReducer(transcript, action);
  };
  const statuses: ConversationStatus[] = [];
  const serverErrors = new Map<string, number>();
  let reconnects = 0;
  let resubmitted = 0;
  let dropped = false;

  let feeding: Promise<void> = Promise.resolve();
  const source = {
    start: async (onBuffer: (block: Float32Array, sampleRate: number) => void) => {
      const tail = new Float32Array(Math.round((rate * TRAILING_SILENCE_MS) / 1000));
      const audio = new Float32Array(samples.length + tail.length);
      audio.set(samples);
      const blockMs = (WORKLET_BLOCK_SAMPLES / rate) * 1000;
      if (args.dropAtMs > 0) {
        setTimeout(() => {
          dropped = proxy.dropClientLeg();
          console.log(`drop-at=${new Date().toISOString()} dropped=${dropped}`);
        }, args.dropAtMs);
      }
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
  const session = new ConversationSession(
    {
      ...pushedCaptureDeps(source),
      createSocket: (handlers, connection) =>
        new TranslateSocket(
          translateSocketUrl(`http://127.0.0.1:${PROXY_PORT}`),
          handlers,
          token,
          connection?.resumeKey,
        ),
      createPlaybackSink: () => silentSink(),
    },
    {
      onStatus: (status) => statuses.push(status),
      onLevel: () => undefined,
      onMuted: () => undefined,
      onError: (message) => {
        if (message) console.error(`error: ${message}`);
      },
      onEchoHeard: () => undefined,
      onServerEvent: (event: ServerEvent) => {
        if (event.type === 'server.error') {
          serverErrors.set(event.code, (serverErrors.get(event.code) ?? 0) + 1);
        }
        dispatch(event as TurnKeyedAction);
      },
      onReset: () => dispatch({ type: 'transcript.reset' }),
      onTurnAbandoned: (sessionId, reason) =>
        dispatch({ type: 'transcript.turnAbandoned', sessionId: sessionId ?? undefined, reason }),
      onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt, preRollMs }) =>
        dispatch({ type: 'transcript.turnCaptureRecorded', sessionId, cutForced, openedAt, closedAt, preRollMs }),
      onDrained: () => dispatch({ type: 'transcript.settled' }),
      onStopped: () => stopped(),
      onLog: (message) => {
        const match = /^reconnected on attempt \d+: resubmitted (\d+)/.exec(message);
        if (match) {
          reconnects += 1;
          resubmitted += Number(match[1]);
        }
      },
    },
    () => ({ ...CASCADE_RUNTIME_OPTIONS, reconnectOnDrop: args.reconnect }),
  );

  console.log(`window-start=${new Date().toISOString()} recording=${id}`);
  await session.start({
    languagePair: args.pair,
    voiceGender: 'female',
    voiceOutput: false,
    speed: 1,
    repairDisplay: true,
    streamCommitted: true,
  } as SessionOptions);
  await feeding;
  session.finish();
  await Promise.race([ended, sleep(DRAIN_TIMEOUT_MS)]);
  session.stop();
  await sleep(2_000);
  proxy.close();

  console.log(`window-end=${new Date().toISOString()}`);
  console.log(
    [
      `turns=${transcript.turns.length}`,
      `dropped=${dropped}`,
      `reconnects=${reconnects}`,
      `resubmitted=${resubmitted}`,
      `connections=${proxy.connections()}`,
      `saw-reconnecting=${statuses.includes('reconnecting')}`,
      `final-status=${statuses.at(-1) ?? 'none'}`,
      `server-errors=${[...serverErrors].map(([code, n]) => `${code}:${n}`).join(',') || 'none'}`,
    ].join(' '),
  );
  process.exit(0);
}

await main();
