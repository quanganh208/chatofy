// Run one real meeting's translation path against any API, and time it.
//
//   cd apps/api && npx tsx ../../benchmarks/conference/replay-meeting.mts \
//     --api http://127.0.0.1:3000 --token-file "$A" --token-file "$B" \
//     --pair 0 --arm turn-taking --seconds 300 --run-tag baseline-1
//
// Each speaker is the SHIPPED leg (`createConferenceCascadeLeg`), fed one whole
// recording in its own language through `pushedCaptureDeps`, on a real
// `/ws/translate` socket and a real `/ws/conference` socket. There is no SFU
// here: joining a room opens no Cloudflare session, and a leg's output travels
// through the room socket. `media-call.mjs` measures the media path.
//
// Everything is timed in this one process, so listener and speaker share a
// clock, which two browser tabs do not. Production records none of this.
//
//   turns.jsonl  timings and ids, no text
//   text.jsonl   what each turn said (gitignored, like the rest of results/)
//   run.json     refusals, relay errors and the time window, for the log query
//
// A token is read from a 0600 file and never printed or put in argv.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConferenceTranslationBroadcast, LanguageCode, ServerEvent } from '../../packages/types/src/index';

import { pushedCaptureDeps } from '../../packages/realtime-client/src/audio/pushed-pcm-capture';
import {
  createConferenceCascadeLeg,
  type ConferenceCascadeLeg,
} from '../../packages/realtime-client/src/conference/conference-cascade-leg';
import {
  TranslateSocket,
  translateSocketUrl,
  type TranslateSocketHandlers,
} from '../../packages/realtime-client/src/transport/translate-socket';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS_SUBPROTOCOL = 'chatofy-v1';
/** What the browser's audio worklet posts per message, at 48 kHz. */
const BLOCK_SAMPLES = 1024;
const SAMPLE_RATE = 48_000;
/** How long one speaker holds the floor on the turn-taking arm. */
const FLOOR_MS = 20_000;
/** How long the last turns may take to finish once the speech has ended. */
const DRAIN_TIMEOUT_MS = 45_000;
/** A polish lands after its final, so listen a little after the last one. */
const POLISH_GRACE_MS = 8_000;
/** Above this the harness stops rather than risk the prod sidecar. */
const ABORT_STT_BYTES = 4 * 1024 ** 3;
const WATCH_INTERVAL_MS = 5_000;
/** Exit code for an abort on prod memory, distinct from a crash. */
const EXIT_ABORTED = 3;

type Arm = 'turn-taking' | 'overlap';

interface Args {
  api: string;
  tokenFiles: string[];
  pair: number;
  arm: Arm;
  seconds: number;
  runTag: string;
  watchProd: boolean;
  /** How many speakers talk; the rest sit in the room as listeners. */
  active: number | null;
  /** Start a recording again when it runs out, so a capacity run keeps talking. */
  loop: boolean;
}

interface Speaker {
  name: string;
  language: LanguageCode;
  recording: string;
  samples: Float32Array;
  token: string;
  /** Next sample of the recording this speaker has not spoken. */
  position: number;
  ws: WebSocket | null;
  socketId: string;
  leg: ConferenceCascadeLeg | null;
  translating: boolean;
}

/** One translated turn, by the server's session id; the room's `turnId` is the same id. */
interface TurnRow {
  speaker: string;
  recording: string;
  language: LanguageCode;
  sessionId: string;
  clientTurnId: string;
  mediaMs: number;
  /** Where in the recording the client closed the turn. */
  mediaEndMs: number | null;
  startMs: number;
  readyMs: number | null;
  endSentMs: number | null;
  finalMs: number | null;
  firstSubtitleMs: number | null;
  listenerFinalMs: number | null;
  firstAudioMs: number | null;
  audioFrames: number;
  audioFramesDelivered: number;
  polishedMs: number | null;
  /** When a listener received the polished translation, once the room carries it. */
  revisedMs: number | null;
  endReason: string | null;
  error: string | null;
}

interface TurnText {
  speaker: string;
  recording: string;
  sessionId: string;
  language: LanguageCode;
  mediaMs: number;
  mediaEndMs: number | null;
  source: string;
  translations: Partial<Record<LanguageCode, string>>;
  polished: Partial<Record<LanguageCode, string>> | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    api: 'http://127.0.0.1:3000',
    tokenFiles: [],
    pair: 0,
    arm: 'turn-taking',
    seconds: 60,
    runTag: '',
    watchProd: false,
    active: null,
    loop: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--api') args.api = next();
    else if (flag === '--token-file') args.tokenFiles.push(next());
    else if (flag === '--pair') args.pair = Number(next());
    else if (flag === '--arm') args.arm = next() as Arm;
    else if (flag === '--seconds') args.seconds = Number(next());
    else if (flag === '--run-tag') args.runTag = next();
    else if (flag === '--watch-prod') args.watchProd = true;
    else if (flag === '--active') args.active = Number(next());
    else if (flag === '--loop') args.loop = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (args.tokenFiles.length < 2) throw new Error('--token-file is required once per speaker, at least twice');
  if (!args.runTag) throw new Error('--run-tag is required');
  if (args.arm !== 'turn-taking' && args.arm !== 'overlap') throw new Error('--arm is turn-taking or overlap');
  if (!(args.seconds > 0)) throw new Error('--seconds must be positive');
  return args;
}

function readToken(path: string): string {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${path} is readable by others; chmod 600 it`);
  const token = readFileSync(path, 'utf8').trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}

/** Mono 16-bit PCM WAV at 48 kHz, as floats. */
function readWav(path: string): Float32Array {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path} is not a RIFF file`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && buffer.readUInt32LE(body + 4) !== SAMPLE_RATE) throw new Error(`${path}: expected 48 kHz`);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(body + i * 2) / 0x8000;
      return samples;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Room tone the gate reads as silence; deterministic so a rerun hears the same thing. */
function fillRoomTone(block: Float32Array, seed: { value: number }): void {
  for (let i = 0; i < block.length; i += 1) {
    seed.value = (seed.value * 1103515245 + 12345) & 0x7fffffff;
    block[i] = ((seed.value / 0x7fffffff) * 2 - 1) * 0.002;
  }
}

async function http<T>(api: string, method: string, path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text) return undefined as T;
  const parsed = JSON.parse(text) as { data?: T };
  return (parsed.data ?? parsed) as T;
}

/** A room socket, joined; every message after the join goes to `onMessage`. */
function joinRoom(
  api: string,
  roomId: string,
  speaker: Speaker,
  onMessage: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const url = new URL(api);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/conference';
  const ws = new WebSocket(url.toString(), [WS_SUBPROTOCOL, speaker.token]);
  speaker.ws = ws;
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', () => reject(new Error(`${speaker.name}: room socket failed`)));
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          event: 'conference.join',
          data: { roomId, displayName: speaker.name, sourceLanguage: speaker.language },
        }),
      );
    });
    ws.addEventListener('message', (message) => {
      const { event, data } = JSON.parse(String(message.data)) as {
        event: string;
        data: Record<string, unknown>;
      };
      if (event === 'conference.join') {
        if (typeof data.error === 'string') reject(new Error(`${speaker.name}: join refused: ${data.error}`));
        else {
          speaker.socketId = String(data.socketId);
          resolve();
        }
        return;
      }
      onMessage(event, data);
    });
  });
}

/** Whose floor it is at `elapsedMs`. */
function holdsFloor(arm: Arm, index: number, speakers: number, elapsedMs: number): boolean {
  if (arm === 'overlap') return true;
  return Math.floor(elapsedMs / FLOOR_MS) % speakers === index;
}

/** `2.982GiB / 5GiB` from `docker stats`, as bytes. */
export function parseMemUsage(text: string): number | null {
  const match = /^\s*([\d.]+)\s*(B|KiB|MiB|GiB)/.exec(text);
  if (!match) return null;
  const unit = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[match[2] as 'B' | 'KiB' | 'MiB' | 'GiB'];
  return Number(match[1]) * unit;
}

function watchProdMemory(onOverLimit: () => void): () => void {
  const timer = setInterval(() => {
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.MemUsage}}', 'chatofy_prod_local_stt'],
      (error, stdout) => {
        if (error) return;
        const bytes = parseMemUsage(stdout);
        if (bytes !== null && bytes > ABORT_STT_BYTES) onOverLimit();
      },
    );
  }, WATCH_INTERVAL_MS);
  return () => clearInterval(timer);
}

const payloadKey = (payload: string) => createHash('sha1').update(payload).digest('base64');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(join(HERE, 'corpus.json'), 'utf8')) as {
    pairs: { vi: string; en: string }[];
  };
  const pair = corpus.pairs[args.pair];
  if (!pair) throw new Error(`no pair ${args.pair}`);
  // A third speaker reuses the next pair's Vietnamese recording.
  const lineup: [LanguageCode, string][] = [
    ['vi', pair.vi],
    ['en', pair.en],
    ['vi', corpus.pairs[(args.pair + 1) % corpus.pairs.length]!.vi],
  ];
  if (args.tokenFiles.length > lineup.length) throw new Error(`at most ${lineup.length} speakers`);

  const speakers: Speaker[] = args.tokenFiles.map((file, index) => {
    const [language, recording] = lineup[index]!;
    return {
      name: `speaker-${index}`,
      language,
      recording,
      samples: readWav(join(HERE, 'data', `${recording}.wav`)),
      token: readToken(file),
      position: 0,
      ws: null,
      socketId: '',
      leg: null,
      translating: false,
    };
  });
  const dir = join(HERE, 'results', args.runTag);
  mkdirSync(dir, { recursive: true });

  const started = Date.now();
  const now = () => Date.now() - started;
  const windowStart = new Date().toISOString();
  const rows = new Map<string, TurnRow>();
  const texts = new Map<string, TurnText>();
  /** A client turn's row until the server names it. */
  const byClientTurn = new Map<string, TurnRow>();
  /** `speaker|lang|sequence` of a relayed frame, to its turn. */
  const audioFrames = new Map<string, TurnRow>();
  /** An incoming server frame's payload, to its turn: frames carry no turn in the room. */
  const framePayloads = new Map<string, TurnRow>();
  const refusals: Record<string, number> = {};
  const relayErrors: Record<string, number> = {};
  let unmatchedAudio = 0;
  const logs: string[] = [];

  const count = (bag: Record<string, number>, key: string) => {
    bag[key] = (bag[key] ?? 0) + 1;
  };

  const onRoomEvent = (listener: Speaker) => (event: string, data: Record<string, unknown>) => {
    if (event === 'conference.translation.subtitle') {
      const row = rows.get(String(data.turnId));
      if (!row) return;
      if (row.firstSubtitleMs === null && (data.translatedText || data.sourceText)) row.firstSubtitleMs = now();
      if (data.isFinal === true) row.listenerFinalMs ??= now();
    } else if (event === 'conference.translation.revised') {
      const row = rows.get(String(data.turnId));
      if (row) row.revisedMs ??= now();
    } else if (event === 'conference.translation.audio') {
      const row = audioFrames.get(`${String(data.speakerSocketId)}|${String(data.lang)}|${String(data.sequence)}`);
      if (!row) return;
      row.audioFramesDelivered += 1;
      row.firstAudioMs ??= now();
    } else if (event === 'conference.translation.broadcast' && typeof data.error === 'string') {
      count(relayErrors, `${listener.name}:${data.error}`);
    }
  };

  const created = await http<{ id: string }>(args.api, 'POST', '/conference', speakers[0]!.token, {
    title: `ruler ${args.runTag}`,
  });
  const roomId = created.id;
  for (const speaker of speakers) await joinRoom(args.api, roomId, speaker, onRoomEvent(speaker));

  const playStart = Date.now();
  const speechEndMs = args.seconds * 1000;
  let stopFeeding = false;
  const feeders: Promise<void>[] = [];
  const rooms: LanguageCode[] = speakers.map((speaker) => speaker.language);

  const buildLeg = (speaker: Speaker, index: number): ConferenceCascadeLeg => {
    const seed = { value: 0x2f6e2b1 + index };
    const source = {
      start: async (onBuffer: (block: Float32Array, sampleRate: number) => void) => {
        const blockMs = (BLOCK_SAMPLES / SAMPLE_RATE) * 1000;
        const legStart = Date.now();
        feeders.push(
          (async () => {
            for (let i = 0; !stopFeeding; i += 1) {
              const elapsed = Date.now() - playStart;
              const block = new Float32Array(BLOCK_SAMPLES);
              if (args.loop && speaker.position + BLOCK_SAMPLES > speaker.samples.length) speaker.position = 0;
              const speaking =
                index < (args.active ?? speakers.length) &&
                elapsed < speechEndMs &&
                speaker.position + BLOCK_SAMPLES <= speaker.samples.length &&
                holdsFloor(args.arm, index, args.active ?? speakers.length, elapsed);
              if (speaking) {
                block.set(speaker.samples.subarray(speaker.position, speaker.position + BLOCK_SAMPLES));
                speaker.position += BLOCK_SAMPLES;
              } else fillRoomTone(block, seed);
              onBuffer(block, SAMPLE_RATE);
              const wait = legStart + (i + 1) * blockMs - Date.now();
              if (wait > 0) await sleep(wait);
            }
          })(),
        );
      },
      stop: async () => undefined,
    };

    let relayingFrame: TurnRow | undefined;

    const track = (event: ServerEvent) => {
      if (event.type === 'server.session.ready') {
        const row = event.turnId === undefined ? undefined : byClientTurn.get(event.turnId);
        if (!row) return;
        row.sessionId = event.sessionId;
        row.readyMs = now();
        rows.set(event.sessionId, row);
        return;
      }
      if (event.type === 'server.audio.frame') {
        const row = rows.get(event.frame.sessionId);
        if (row) framePayloads.set(payloadKey(event.frame.payload), row);
        return;
      }
      if (event.type === 'server.error') {
        count(refusals, event.code);
        const named = 'sessionId' in event ? rows.get(String(event.sessionId)) : undefined;
        if (named) named.error ??= event.code;
        return;
      }
      if (!('sessionId' in event) || typeof event.sessionId !== 'string') return;
      const row = rows.get(event.sessionId);
      if (!row) return;
      if (event.type === 'server.transcript.final') {
        row.finalMs = now();
        const translations = event.segment.translations as Partial<Record<LanguageCode, string>>;
        texts.set(event.sessionId, {
          speaker: speaker.name,
          recording: speaker.recording,
          sessionId: event.sessionId,
          language: speaker.language,
          mediaMs: row.mediaMs,
          mediaEndMs: row.mediaEndMs,
          source: event.segment.sourceText,
          translations,
          polished: null,
        });
      } else if (event.type === 'server.translation.polished') {
        row.polishedMs = now();
        const text = texts.get(event.sessionId);
        if (text) text.polished = event.translations as Partial<Record<LanguageCode, string>>;
      } else if (event.type === 'server.session.ended') {
        row.endReason = event.reason;
      }
    };

    // Records what the leg sends and hears on its translate socket, and changes nothing.
    class TimedSocket extends TranslateSocket {
      override startSession(options: Parameters<TranslateSocket['startSession']>[0], turnId: string): void {
        const row: TurnRow = {
          speaker: speaker.name,
          recording: speaker.recording,
          language: speaker.language,
          sessionId: '',
          clientTurnId: turnId,
          mediaMs: Math.round((speaker.position / SAMPLE_RATE) * 1000),
          mediaEndMs: null,
          startMs: now(),
          readyMs: null,
          endSentMs: null,
          finalMs: null,
          firstSubtitleMs: null,
          listenerFinalMs: null,
          firstAudioMs: null,
          audioFrames: 0,
          audioFramesDelivered: 0,
          polishedMs: null,
          revisedMs: null,
          endReason: null,
          error: null,
        };
        byClientTurn.set(turnId, row);
        super.startSession(options, turnId);
      }

      override endSession(sessionId: string | null): void {
        const row = sessionId === null ? undefined : rows.get(sessionId);
        if (row) {
          row.endSentMs ??= now();
          row.mediaEndMs ??= Math.round((speaker.position / SAMPLE_RATE) * 1000);
        }
        super.endSession(sessionId);
      }
    }

    return createConferenceCascadeLeg({
      audioDeps: pushedCaptureDeps(source),
      createSocket: (handlers: TranslateSocketHandlers, token: string) =>
        new TimedSocket(
          translateSocketUrl(args.api),
          {
            ...handlers,
            onEvent: (event) => {
              track(event);
              handlers.onEvent(event);
            },
          },
          token,
        ),
      getToken: async () => speaker.token,
      sendBroadcast: (envelope: ConferenceTranslationBroadcast) => {
        if (envelope.audio) {
          relayingFrame = framePayloads.get(payloadKey(envelope.audio.payload));
          if (relayingFrame) {
            relayingFrame.audioFrames += 1;
            audioFrames.set(
              `${speaker.socketId}|${envelope.audio.lang}|${envelope.audio.sequence}`,
              relayingFrame,
            );
          } else unmatchedAudio += 1;
        }
        speaker.ws?.send(JSON.stringify({ event: 'conference.translation.broadcast', data: envelope }));
      },
      sourceLanguage: speaker.language,
      roomLanguages: rooms,
      onTranslatingChange: (translating) => {
        speaker.translating = translating;
      },
      onEnded: (reason) => logs.push(`${speaker.name}: translation ended: ${reason}`),
      onLog: (message) => logs.push(`${speaker.name}: ${message}`),
    });
  };

  let aborted = false;
  const stopWatching = args.watchProd
    ? watchProdMemory(() => {
        aborted = true;
      })
    : () => undefined;

  try {
    speakers.forEach((speaker, index) => {
      speaker.leg = buildLeg(speaker, index);
    });
    await Promise.all(speakers.map((speaker) => speaker.leg!.start()));

    while (Date.now() - playStart < speechEndMs && !aborted) await sleep(250);
    // The gate needs room tone to close the last turn, and in-flight turns need time.
    const drainUntil = Date.now() + DRAIN_TIMEOUT_MS;
    await sleep(3_000);
    while (!aborted && Date.now() < drainUntil && speakers.some((speaker) => speaker.translating)) await sleep(250);
    if (!aborted) await sleep(POLISH_GRACE_MS);
    await Promise.all(speakers.map((speaker) => (aborted ? speaker.leg?.stop() : speaker.leg?.leave())));
    stopFeeding = true;
    await Promise.all(feeders);
  } finally {
    stopWatching();
    stopFeeding = true;
    for (const speaker of speakers) speaker.leg?.stop();
    await http(args.api, 'DELETE', `/conference/${roomId}`, speakers[0]!.token).catch((error) => {
      logs.push(`could not end the room: ${String(error)}`);
    });
    for (const speaker of speakers) speaker.ws?.close();
  }

  const finishedRows = [...new Set([...byClientTurn.values()])];
  writeFileSync(join(dir, 'turns.jsonl'), finishedRows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(join(dir, 'text.jsonl'), [...texts.values()].map((text) => JSON.stringify(text)).join('\n') + '\n');
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify(
      {
        runTag: args.runTag,
        arm: args.arm,
        pair: args.pair,
        seconds: args.seconds,
        speakers: speakers.map(({ name, language, recording }) => ({ name, language, recording })),
        aborted,
        windowStart,
        windowEnd: new Date().toISOString(),
        refusals,
        relayErrors,
        unmatchedAudio,
        logs: logs.slice(-200),
      },
      null,
      2,
    ),
  );
  console.log(`run=${args.runTag} turns=${finishedRows.length} finals=${texts.size} aborted=${aborted}`);
  // A leg's reconnect timer can outlive the run; the run is over.
  process.exit(aborted ? EXIT_ABORTED : 0);
}

await main();
