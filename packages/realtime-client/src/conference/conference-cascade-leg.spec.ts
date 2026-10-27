import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConferenceTranslationAudio,
  ConferenceTranslationBroadcast,
  ConferenceTranslationSubtitle,
  LanguageCode,
  ServerEvent,
} from '@chatofy/types';
import {
  CONFERENCE_LEG_RUNTIME_OPTIONS,
  createConferenceCascadeLeg,
  type ConferenceCascadeLegOptions,
  type ConferenceLegEndReason,
} from './conference-cascade-leg.js';
import { pushedCaptureDeps, type PushedPcmSource } from '../audio/pushed-pcm-capture.js';
import { PcmPlaybackQueue } from '../audio/pcm-playback-queue.js';
import { base64ToPcm16, pcm16ToBase64 } from '../audio/pcm-resampler.js';
import { CASCADE_RUNTIME_OPTIONS } from '../conversation/cascade-runtime-options.js';
import { FakeTranslateSocket } from '../conversation/fake-audio-context.js';
import type { TranslateSocket } from '../transport/translate-socket.js';

/** The runtime options every session the leg builds was given. */
const { sessionRuntimes } = vi.hoisted(() => ({ sessionRuntimes: [] as unknown[] }));

vi.mock('../conversation/conversation-session.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../conversation/conversation-session.js')>();
  class RecordingSession extends original.ConversationSession {
    constructor(...args: ConstructorParameters<typeof original.ConversationSession>) {
      sessionRuntimes.push(args[2]?.());
      super(...args);
    }
  }
  return { ...original, ConversationSession: RecordingSession };
});

/**
 * The speaker leg end to end: real `ConversationSession`, real ordering, real
 * relay sink, fed by the pushed-PCM shim and answered by a fake translate socket.
 * Server ids are UUIDs because the room refuses anything else as a `turnId`.
 */

/** A recorder the test pushes 48 kHz buffers through. */
class FakeSource implements PushedPcmSource {
  private onBuffer: ((samples: Float32Array, rate: number) => void) | null = null;
  started = 0;
  /** Refuse every start, as a recorder without microphone permission does. */
  refuse = false;

  start(onBuffer: (samples: Float32Array, rate: number) => void): Promise<void> {
    this.started += 1;
    if (this.refuse) return Promise.reject(new Error('microphone permission not granted'));
    this.onBuffer = onBuffer;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.onBuffer = null;
    return Promise.resolve();
  }

  push(samples: Float32Array): void {
    this.onBuffer?.(samples, 48000);
  }
}

const BLOCKS_TO_CONFIRM_SPEECH = 8;
const BLOCKS_TO_CLOSE_TURN = 30;

const speechBlock = () => Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 3) * 0.25);
const silenceBlock = () => new Float32Array(1024);

const uuid = () => crypto.randomUUID();

/** One frame of translated speech, every sample set to `marker` so it can be recognised. */
const audioFrame = (
  sessionId: string,
  {
    lang,
    marker = 1,
    seconds = 0.1,
  }: { lang?: LanguageCode; marker?: number; seconds?: number } = {},
): ServerEvent => ({
  type: 'server.audio.frame',
  frame: {
    sessionId,
    encoding: 'pcm16',
    sampleRate: 24000,
    sequence: 0,
    timestamp: 0,
    payload: pcm16ToBase64(new Int16Array(Math.round(24000 * seconds)).fill(marker)),
  },
  ...(lang === undefined ? {} : { lang }),
});

const delta = (sessionId: string, committed: string): ServerEvent => ({
  type: 'server.transcript.delta',
  sessionId,
  committed,
  pending: '',
  reanchors: 0,
  speaker: 'speaker_a',
  languagePair: { source: 'vi', target: 'en' },
});

const translationDelta = (sessionId: string, text: string): ServerEvent => ({
  type: 'server.translation.delta',
  sessionId,
  delta: text,
  generation: 0,
  languagePair: { source: 'vi', target: 'en' },
});

const finalEvent = (
  sessionId: string,
  sourceText: string,
  translations: Partial<Record<LanguageCode, string>>,
): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: {
    id: uuid(),
    sessionId,
    speakerRole: 'speaker_a',
    sourceLanguages: ['vi'],
    translations,
    sourceText,
    audioUrl: null,
    createdAt: new Date(0).toISOString(),
  },
});

const ended = (sessionId: string, reason = 'completed'): ServerEvent => ({
  type: 'server.session.ended',
  sessionId,
  reason,
});

interface HarnessOptions {
  roomLanguages?: LanguageCode[];
  tokens?: (string | undefined)[];
  /** Strip the source-level mute, so only the session's pause can gate capture. */
  noSourceMute?: boolean;
  /** Hold every socket's connect until the test releases it. */
  holdConnect?: boolean;
  /** The recorder refuses to start. */
  micRefused?: boolean;
  /** A peer's translation sounding on this device's loudspeaker. */
  receivedSounding?: () => boolean;
}

function harness(options: HarnessOptions = {}) {
  const source = new FakeSource();
  source.refuse = options.micRefused ?? false;
  const ended: ConferenceLegEndReason[] = [];
  const sockets: FakeTranslateSocket[] = [];
  const socketTokens: string[] = [];
  const broadcasts: ConferenceTranslationBroadcast[] = [];
  const logs: string[] = [];
  const translating: boolean[] = [];
  const connects: (() => void)[] = [];
  let tokenCount = 0;
  const getToken = vi.fn(() => {
    const queued = options.tokens;
    if (queued && tokenCount < queued.length) return Promise.resolve(queued[tokenCount++]);
    tokenCount += 1;
    return Promise.resolve(`tok-${tokenCount}`);
  });
  const deps = pushedCaptureDeps(source);
  const legOptions: ConferenceCascadeLegOptions = {
    audioDeps: options.noSourceMute ? { ...deps, setPaused: undefined } : deps,
    createSocket: (handlers, token) => {
      const socket = new FakeTranslateSocket(handlers);
      if (options.holdConnect) {
        socket.connect = () => new Promise<void>((resolve) => connects.push(resolve));
      }
      sockets.push(socket);
      socketTokens.push(token);
      return socket as unknown as TranslateSocket;
    },
    getToken,
    sendBroadcast: (envelope) => broadcasts.push(envelope),
    sourceLanguage: 'vi',
    roomLanguages: options.roomLanguages ?? ['en'],
    onTranslatingChange: (value) => translating.push(value),
    onEnded: (reason) => ended.push(reason),
    onLog: (message) => logs.push(message),
    ...(options.receivedSounding ? { receivedSounding: options.receivedSounding } : {}),
  };
  const leg = createConferenceCascadeLeg(legOptions);

  const socket = () => sockets[sockets.length - 1]!;
  const talk = () => {
    for (let i = 0; i < BLOCKS_TO_CONFIRM_SPEECH; i += 1) source.push(speechBlock());
  };
  const hush = () => {
    for (let i = 0; i < BLOCKS_TO_CLOSE_TURN; i += 1) source.push(silenceBlock());
  };
  /** Speak one turn and have the server name it. Returns the server session id. */
  const speakTurn = (): string => {
    talk();
    hush();
    const starts = socket().sent.filter((e) => e.type === 'client.session.start');
    const turnId = starts[starts.length - 1]!.turnId;
    const sessionId = uuid();
    socket().emit({ type: 'server.session.ready', sessionId, turnId });
    return sessionId;
  };
  const subtitles = (): ConferenceTranslationSubtitle[] =>
    broadcasts.flatMap((b) => (b.subtitle ? [b.subtitle] : []));
  const audio = (): ConferenceTranslationAudio[] =>
    broadcasts.flatMap((b) => (b.audio ? [b.audio] : []));
  const finals = () => subtitles().filter((s) => s.isFinal);
  const starts = () =>
    sockets.flatMap((s) => s.sent.filter((e) => e.type === 'client.session.start'));

  return {
    leg,
    source,
    sockets,
    socketTokens,
    broadcasts,
    logs,
    translating,
    ended,
    connects,
    getToken,
    socket,
    talk,
    hush,
    speakTurn,
    subtitles,
    audio,
    finals,
    starts,
  };
}

/** The marker a relayed frame was built with. */
const markerOf = (frame: ConferenceTranslationAudio) => base64ToPcm16(frame.payload)[0];

beforeEach(() => {
  vi.useFakeTimers();
  sessionRuntimes.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createConferenceCascadeLeg', () => {
  describe('one turn', () => {
    it('relays growing subtitles and exactly one final, keyed by the server session id', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin chào'));
      h.socket().emit(translationDelta(s1, 'hello'));
      for (let i = 0; i < 3; i += 1) h.socket().emit(audioFrame(s1));
      h.socket().emit(finalEvent(s1, 'xin chào bạn', { en: 'hello friend' }));
      h.socket().emit(ended(s1));

      const subtitles = h.subtitles();
      expect(subtitles.every((s) => s.turnId === s1)).toBe(true);
      expect(subtitles.map((s) => [s.sourceText, s.translatedText, s.isFinal])).toEqual([
        ['xin chào', '', false],
        ['xin chào', 'hello', false],
        ['xin chào bạn', 'hello friend', true],
      ]);
      expect(h.finals()[0]!.translations).toEqual({ en: 'hello friend' });
      expect(h.audio().map((a) => [a.lang, a.sequence])).toEqual([
        ['en', 0],
        ['en', 1],
        ['en', 2],
      ]);
      expect(h.translating).toEqual([true, false]);
    });

    it('asks for the cascade it relays: the room target, settled text, no speaker splitting, the meeting ceiling', async () => {
      const h = harness({ roomLanguages: ['en', 'zh', 'vi'] });
      await h.leg.start();
      h.talk();

      const options = h.starts()[0]!.options!;
      expect(options.languagePair).toEqual({ source: 'vi', target: 'en' });
      expect(options.alsoTranslateInto).toEqual(['zh']);
      expect(options.voiceOutput).toBe(true);
      expect(options.streamCommitted).toBe(true);
      expect(options.meeting).toBe(true);
      expect(options.splitSpeakers).toBeUndefined();
      expect(options.embedSpeaker).toBeUndefined();
    });

    it('falls back to the default target and no speech in a room with nobody else', async () => {
      const h = harness({ roomLanguages: [] });
      await h.leg.start();
      h.talk();

      const options = h.starts()[0]!.options!;
      expect(options.languagePair).toEqual({ source: 'vi', target: 'en' });
      expect(options.voiceOutput).toBe(false);
      expect(options.alsoTranslateInto).toBeUndefined();
    });

    it('never plays anything on this machine', async () => {
      const enqueue = vi.spyOn(PcmPlaybackQueue.prototype, 'enqueue');
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(audioFrame(s1));

      expect(h.audio()).toHaveLength(1);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('runs its session on the shared tuning, owning its echo measurement', async () => {
      // Relayed audio is "out" while nobody here hears it; fed to the pump as
      // sounding, a speaker who keeps talking would be filed as echo.
      expect(CONFERENCE_LEG_RUNTIME_OPTIONS).toEqual({
        ...CASCADE_RUNTIME_OPTIONS,
        ownsEchoMeasurement: true,
      });
      const h = harness();
      await h.leg.start();

      expect(sessionRuntimes).toEqual([CONFERENCE_LEG_RUNTIME_OPTIONS]);
    });
  });

  describe('overlapping turns', () => {
    it('relays audio in speaking order, never interleaved', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      const s2 = h.speakTurn();

      // The second turn answers first; its audio waits behind the first.
      h.socket().emit(audioFrame(s2, { marker: 2 }));
      h.socket().emit(audioFrame(s2, { marker: 2 }));
      h.socket().emit(audioFrame(s1, { marker: 1 }));
      h.socket().emit(audioFrame(s1, { marker: 1 }));
      h.socket().emit(ended(s1));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(h.audio().map(markerOf)).toEqual([1, 1, 2, 2]);
      expect(h.audio().map((a) => a.sequence)).toEqual([0, 1, 2, 3]);
    });

    it('keeps two overlapping two-language 7 s turns, each frame in its own language', async () => {
      const h = harness({ roomLanguages: ['en', 'zh'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      const s2 = h.speakTurn();
      const sent: [number, LanguageCode][] = [];
      const emit = (sessionId: string, marker: number, lang: LanguageCode) => {
        sent.push([marker, lang]);
        h.socket().emit(audioFrame(sessionId, { marker, lang, seconds: 1 }));
      };

      for (let i = 0; i < 7; i += 1) {
        emit(s2, 20 + i, i % 2 ? 'zh' : 'en');
        emit(s2, 30 + i, i % 2 ? 'en' : 'zh');
      }
      for (let i = 0; i < 7; i += 1) {
        emit(s1, 0 + i, 'en');
        emit(s1, 10 + i, 'zh');
      }
      h.socket().emit(ended(s1));
      await vi.advanceTimersByTimeAsync(8_000);

      expect(h.logs.some((line) => line.includes('dropped turn'))).toBe(false);
      const relayed = h.audio().map((a) => [markerOf(a), a.lang]);
      const expected = [
        ...sent.filter(([marker]) => marker < 20),
        ...sent.filter(([marker]) => marker >= 20),
      ];
      expect(relayed).toEqual(expected);
    });

    it('numbers each language on its own counter', async () => {
      const h = harness({ roomLanguages: ['en', 'zh'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      for (const lang of ['en', 'zh', 'en', 'zh', 'en'] as const) {
        h.socket().emit(audioFrame(s1, { lang }));
      }

      expect(h.audio().map((a) => [a.lang, a.sequence])).toEqual([
        ['en', 0],
        ['zh', 0],
        ['en', 1],
        ['zh', 1],
        ['en', 2],
      ]);
    });
  });

  describe('the language of untagged audio', () => {
    it('is the target the turn started with, not the room now', async () => {
      const h = harness({ roomLanguages: ['en'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      // The English listener leaves and a Chinese one joins before the audio is out.
      h.leg.setRoomLanguages(['zh']);
      h.socket().emit(audioFrame(s1));
      h.socket().emit(audioFrame(s1));

      expect(h.audio().map((a) => [a.lang, a.sequence])).toEqual([
        ['en', 0],
        ['en', 1],
      ]);
    });

    it('keeps a one-language turn’s audio after a third language joins', async () => {
      const h = harness({ roomLanguages: ['en'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      h.leg.setRoomLanguages(['en', 'zh']);
      h.socket().emit(audioFrame(s1));

      expect(h.audio().map((a) => a.lang)).toEqual(['en']);
      expect(h.logs.some((line) => line.includes('untagged'))).toBe(false);
    });

    it('labels live subtitles with the turn’s start language across a room change', async () => {
      const h = harness({ roomLanguages: ['en'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(translationDelta(s1, 'hel'));
      h.leg.setRoomLanguages(['zh']);
      h.socket().emit(translationDelta(s1, 'lo'));
      h.socket().emit(ended(s1, 'no_speech'));

      expect(h.subtitles().map((s) => s.targetLanguage)).toEqual(['en', 'en', 'en']);
      expect(h.subtitles()[1]!.translations).toEqual({ en: 'hello' });
    });
  });

  describe('a turn whose extra language the speech engine cannot voice', () => {
    /**
     * What the server sends for a vi turn asked for en + zh when zh cannot be
     * spoken: both translations in the final, audio in English only.
     */
    const serveEnglishOnly = (
      h: ReturnType<typeof harness>,
      sessionId: string,
      lang: LanguageCode | undefined,
    ) => {
      h.socket().emit(delta(sessionId, 'xin chào'));
      h.socket().emit(translationDelta(sessionId, 'hello'));
      for (let i = 0; i < 3; i += 1) h.socket().emit(audioFrame(sessionId, { lang }));
      h.socket().emit(finalEvent(sessionId, 'xin chào', { en: 'hello', zh: '你好' }));
      h.socket().emit(ended(sessionId));
    };

    it.each([
      ['tags every frame with the voiced language', 'en' as const],
      ['sends frames untagged, as servers before the tag always did', undefined],
    ])('relays the English audio when the server %s', async (_case, lang) => {
      const h = harness({ roomLanguages: ['en', 'zh'] });
      await h.leg.start();
      const s1 = h.speakTurn();
      expect(h.starts()[0]!.options!.alsoTranslateInto).toEqual(['zh']);

      serveEnglishOnly(h, s1, lang);

      expect(h.audio().map((a) => [a.lang, a.sequence])).toEqual([
        ['en', 0],
        ['en', 1],
        ['en', 2],
      ]);
      expect(h.finals()).toEqual([
        expect.objectContaining({
          turnId: s1,
          targetLanguage: 'en',
          translatedText: 'hello',
          translations: { en: 'hello', zh: '你好' },
        }),
      ]);
      expect(h.logs.some((line) => line.includes('untagged'))).toBe(false);
    });
  });

  describe('restarting a dropped translate socket', () => {
    it('rebuilds with a fresh token and keeps every counter running', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(audioFrame(s1));
      h.socket().emit(audioFrame(s1));

      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(h.sockets).toHaveLength(2);
      expect(h.socketTokens).toEqual(['tok-1', 'tok-2']);
      expect(h.getToken).toHaveBeenCalledTimes(2);

      const s2 = h.speakTurn();
      h.socket().emit(audioFrame(s2));
      expect(h.audio().map((a) => a.sequence)).toEqual([0, 1, 2]);
    });

    it('clears an open turn on a drop without marking it final', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));

      h.socket().drop(1006);

      expect(h.finals()).toEqual([]);
      expect(h.subtitles().at(-1)).toMatchObject({ turnId: s1, sourceText: '', isFinal: false });
      expect(h.translating).toEqual([true, false]);
    });

    it.each([1008, 4001, 4410])('does not reconnect after a %i close', async (code) => {
      const h = harness();
      await h.leg.start();

      h.socket().drop(code);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.sockets).toHaveLength(1);
      expect(h.getToken).toHaveBeenCalledTimes(1);
    });

    it('opens no socket and no microphone once stopped during the backoff', async () => {
      const h = harness();
      await h.leg.start();
      h.socket().drop(1006);

      h.leg.stop();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.sockets).toHaveLength(1);
      expect(h.source.started).toBe(1);
      expect(h.getToken).toHaveBeenCalledTimes(1);
    });

    it('opens no socket and no microphone once left during the backoff', async () => {
      const h = harness();
      await h.leg.start();
      h.socket().drop(1006);

      await h.leg.leave();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.sockets).toHaveLength(1);
      expect(h.source.started).toBe(1);
    });

    it('gives up after three tries', async () => {
      const h = harness();
      await h.leg.start();
      for (const delay of [1_000, 2_000, 4_000]) {
        h.socket().drop(1006);
        await vi.advanceTimersByTimeAsync(delay);
      }
      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(h.sockets).toHaveLength(4);
      expect(h.logs.some((line) => line.includes('after 3 reconnect attempts'))).toBe(true);
    });

    it('starts a fresh budget once a session has been live for over a minute', async () => {
      const h = harness();
      await h.leg.start();
      for (const delay of [1_000, 2_000]) {
        h.socket().drop(1006);
        await vi.advanceTimersByTimeAsync(delay);
      }
      await vi.advanceTimersByTimeAsync(61_000);

      h.socket().drop(1006);
      // The first step of the backoff again, not the third.
      await vi.advanceTimersByTimeAsync(1_000);

      expect(h.sockets).toHaveLength(4);
    });

    it('ends translation when there is no token to rebuild with', async () => {
      const h = harness({ tokens: ['tok-1', undefined] });
      await h.leg.start();

      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.sockets).toHaveLength(1);
      expect(h.getToken).toHaveBeenCalledTimes(2);
      expect(h.ended).toEqual(['no_token']);
    });

    it('does not retry a start that failed before reaching the network', async () => {
      const h = harness({ micRefused: true });
      await h.leg.start();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.source.started).toBe(1);
      expect(h.sockets).toHaveLength(0);
      expect(h.getToken).toHaveBeenCalledTimes(1);
      expect(h.ended).toEqual(['start_failed']);
    });
  });

  describe('ending for good', () => {
    it('reports no token at the first start', async () => {
      const h = harness({ tokens: [undefined] });
      await h.leg.start();

      expect(h.ended).toEqual(['no_token']);
    });

    it.each([1008, 4001, 4410])('reports a %i close as a refusal, once', async (code) => {
      const h = harness();
      await h.leg.start();

      h.socket().drop(code);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(h.ended).toEqual(['refused']);
    });

    it('reports the retry budget running out, once', async () => {
      const h = harness();
      await h.leg.start();
      for (const delay of [1_000, 2_000, 4_000]) {
        h.socket().drop(1006);
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(h.ended).toEqual([]);
      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(h.ended).toEqual(['retries_exhausted']);
    });

    it('reports nothing for a leave or a stop the caller asked for', async () => {
      const left = harness();
      await left.leg.start();
      await left.leg.leave();
      const stopped = harness();
      await stopped.leg.start();
      stopped.leg.stop();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(left.ended).toEqual([]);
      expect(stopped.ended).toEqual([]);
    });
  });

  describe('a peer translation sounding on this device', () => {
    it('starts no turn while it sounds, and listens again once it stops', async () => {
      let received = true;
      const h = harness({ receivedSounding: () => received });
      await h.leg.start();
      h.talk();
      h.talk();
      expect(h.starts()).toEqual([]);

      received = false;
      h.talk();
      expect(h.starts()).toHaveLength(1);
    });

    it('hands the session the shared tuning plus the gate, on every rebuild', async () => {
      const receivedSounding = () => false;
      const h = harness({ receivedSounding });
      await h.leg.start();
      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(h.sockets).toHaveLength(2);
      expect(sessionRuntimes).toEqual([
        { ...CONFERENCE_LEG_RUNTIME_OPTIONS, receivedSounding },
        { ...CONFERENCE_LEG_RUNTIME_OPTIONS, receivedSounding },
      ]);
    });
  });

  describe('mute', () => {
    it('relays nothing while muted, across a forced restart', async () => {
      // No source-level drop: only the session's own pause stands between the
      // microphone and the room, so this proves the leg re-applies it.
      const h = harness({ noSourceMute: true });
      h.leg.pause();
      await h.leg.start();
      h.talk();
      h.hush();

      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(1_000);
      h.talk();
      h.hush();

      expect(h.sockets).toHaveLength(2);
      expect(h.starts()).toEqual([]);
      expect(h.broadcasts).toEqual([]);
      expect(h.leg.muted).toBe(true);
    });

    it('listens again on resume', async () => {
      const h = harness({ noSourceMute: true });
      h.leg.pause();
      await h.leg.start();
      h.leg.resume();
      h.talk();

      expect(h.starts()).toHaveLength(1);
    });
  });

  describe('turns that end without a final', () => {
    it('relays the real final after a turn was abandoned for backlog', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      const s2 = h.speakTurn();
      h.socket().emit(delta(s2, 'hai'));
      // Held behind a silent head and past the ceiling: playback gives up on it.
      h.socket().emit(audioFrame(s2, { seconds: 13 }));
      expect(h.logs.some((line) => line.includes('backlog'))).toBe(true);

      h.socket().emit(finalEvent(s2, 'hai ba', { en: 'two three' }));
      h.socket().emit(ended(s2));
      h.socket().emit(ended(s1, 'no_speech'));

      expect(h.finals()).toEqual([expect.objectContaining({ turnId: s2, sourceText: 'hai ba' })]);
    });

    it('sends no final for a turn that ended without one', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'ừm'));
      h.socket().emit(ended(s1, 'no_speech'));

      expect(h.finals()).toEqual([]);
      expect(h.translating).toEqual([true, false]);
    });
  });

  describe('ending', () => {
    it('relays an in-flight turn’s real final before leave resolves', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));
      const order: string[] = [];

      const left = h.leg.leave().then(() => order.push('left'));
      await vi.advanceTimersByTimeAsync(0);
      h.socket().emit(finalEvent(s1, 'xin chào', { en: 'hello' }));
      order.push('final');
      h.socket().emit(ended(s1));
      await left;

      expect(order).toEqual(['final', 'left']);
      expect(h.finals()).toHaveLength(1);
    });

    it('stops after the drain bound and relays no final for what was cut', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));

      const left = h.leg.leave();
      await vi.advanceTimersByTimeAsync(3_000);
      await left;

      expect(h.finals()).toEqual([]);
      expect(h.subtitles().at(-1)).toMatchObject({ turnId: s1, sourceText: '', isFinal: false });
      expect(h.socket().closed).toBeGreaterThan(0);
    });

    it('lets a stop during a leave’s drain end the leave at once', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));
      let left = false;

      const leaving = h.leg.leave().then(() => (left = true));
      await vi.advanceTimersByTimeAsync(0);
      h.leg.stop();
      await vi.advanceTimersByTimeAsync(0);

      expect(left).toBe(true);
      await leaving;
    });

    it('gives a second leave the same drain as the first', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));

      const first = h.leg.leave();
      const second = h.leg.leave();

      expect(second).toBe(first);
      await vi.advanceTimersByTimeAsync(3_000);
      await first;
    });

    it('stops hard with no final, and only once', async () => {
      const h = harness();
      await h.leg.start();
      const s1 = h.speakTurn();
      h.socket().emit(delta(s1, 'xin'));

      h.leg.stop();
      h.leg.stop();

      expect(h.finals()).toEqual([]);
      expect(h.subtitles().filter((s) => s.sourceText === '')).toHaveLength(1);
    });
  });

  describe('room languages', () => {
    it('applies a language that joined during the start to the first turn', async () => {
      const h = harness({ holdConnect: true });
      const started = h.leg.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.connects).toHaveLength(1);

      h.leg.setRoomLanguages(['en', 'zh']);
      h.connects[0]!();
      await started;
      h.talk();

      expect(h.starts()[0]!.options!.alsoTranslateInto).toEqual(['zh']);
    });

    it('applies a later change to the next turn', async () => {
      const h = harness();
      await h.leg.start();
      h.speakTurn();
      h.leg.setRoomLanguages(['zh']);
      h.talk();

      expect(h.starts().map((s) => s.options!.languagePair.target)).toEqual(['en', 'zh']);
    });
  });

  it('counts the room refusing a broadcast', () => {
    const h = harness();
    h.leg.noteRelayError('limit_reached');
    h.leg.noteRelayError('limit_reached');

    expect(h.logs.at(-1)).toContain('limit_reached');
    expect(h.logs.at(-1)).toContain('2 refused');
  });
});
