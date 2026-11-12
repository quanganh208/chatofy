// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicProcessing, ServerEvent } from '@chatofy/types';
import type { ConversationSessionListeners } from '@chatofy/realtime-client';
import {
  useStreamingTranslate,
  type StartOptions,
  type UseStreamingTranslate,
} from './use-streaming-translate';

/**
 * The conversation id, and only the conversation id.
 *
 * It is minted inside `start`, not once per mount, and the difference is the
 * whole reason this spec exists. `start` fires `onReset`, which clears the
 * transcript; a save keyed by a per-mount id would then `PUT` the SECOND
 * conversation over the first — deleting it with no error and nothing on screen
 * to say so. A dropped socket makes the session stop itself, so anyone resuming
 * after a network blip hits that case every time.
 */

// Declared through `vi.hoisted` because `vi.mock` is hoisted above every
// top-level binding, and a factory closing over a plain `class` here would read
// it before initialization.
const FakeConversationSession = vi.hoisted(() => {
  class Fake {
    static last: Fake | null = null;
    readonly listeners: ConversationSessionListeners;
    /** What the hook supplied, so a case can open the microphone and read the runtime. */
    readonly deps: { openMicrophone: () => Promise<MediaStream> };
    readonly runtime: () => { fullDuplex?: boolean };

    constructor(
      deps: { openMicrophone: () => Promise<MediaStream> },
      listeners: ConversationSessionListeners,
      runtime: () => { fullDuplex?: boolean },
    ) {
      this.deps = deps;
      this.listeners = listeners;
      this.runtime = runtime;
      Fake.last = this;
    }

    /** What each `start` was handed, so a case can read what reached the wire. */
    startedWith: Record<string, unknown>[] = [];

    start = (options: Record<string, unknown>): Promise<void> => {
      this.startedWith.push(options);
      this.listeners.onReset();
      this.listeners.onStatus('listening');
      return Promise.resolve();
    };

    stop = (): void => {
      this.listeners.onStatus('idle');
      this.listeners.onStopped?.();
    };

    retranslateBlock = vi.fn();

    // Pause bookkeeping the way the real session does it: an interval opened
    // on pause, closed on resume, and every change reported as a new array.
    isPaused = false;
    pauseIntervals: { startedAt: number; endedAt: number | null }[] = [];
    pause = (): void => {
      if (this.isPaused) return;
      this.isPaused = true;
      this.pauseIntervals = [...this.pauseIntervals, { startedAt: Date.now(), endedAt: null }];
      this.listeners.onPauses?.(this.pauseIntervals);
      this.listeners.onStatus('paused');
    };
    resume = (): void => {
      if (!this.isPaused) return;
      this.isPaused = false;
      const last = this.pauseIntervals.at(-1)!;
      this.pauseIntervals = [
        ...this.pauseIntervals.slice(0, -1),
        { startedAt: last.startedAt, endedAt: Date.now() },
      ];
      this.listeners.onPauses?.(this.pauseIntervals);
      this.listeners.onStatus('listening');
    };
  }
  return Fake;
});

vi.mock('@chatofy/realtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatofy/realtime-client')>();
  return { ...actual, ConversationSession: FakeConversationSession };
});
vi.mock('@/hooks/use-access-token', () => ({
  useAccessToken: () => ({ current: () => 'token', isLoading: () => false }),
}));
vi.mock('@/hooks/use-auth-recovery', () => ({
  useAuthRecovery: () => ({ handleConnectionFailure: () => Promise.resolve() }),
}));
vi.mock('@/i18n/provider', () => ({
  useTranslate: () => (key: string) => key,
  useLocale: () => 'en',
}));

const options: StartOptions = {
  languagePair: { source: 'vi', target: 'en' },
  voiceGender: 'female',
  mode: 'two-way',
};

let container: HTMLDivElement;
let root: Root;
let latest: UseStreamingTranslate;

function Probe() {
  const value = useStreamingTranslate();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  FakeConversationSession.last = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
    // Lets the promises the effects queued settle before the assertions
    // read state back — which is what makes this `act` async at all.
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('useStreamingTranslate conversation identity', () => {
  it('has no conversation id before the first start', () => {
    expect(latest.conversationId).toBeNull();
    expect(latest.startedAt).toBeNull();
  });

  it('two conversations in one mount produce two different conversation ids', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const first = latest.conversationId;
    expect(first).toBeTruthy();
    expect(latest.startedAt).toBeTruthy();

    await act(async () => {
      latest.stop();
      await Promise.resolve();
    });
    await act(async () => {
      await latest.start(options);
    });

    // Same mount, same hook instance — and a different id, which is what stops
    // the second conversation from full-replacing the first.
    expect(latest.conversationId).toBeTruthy();
    expect(latest.conversationId).not.toBe(first);
  });

  it('a socket drop followed by a restart does not reuse the previous id', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const before = latest.conversationId;

    // The session stopping ITSELF: a dropped socket calls its own `stop`, which
    // reports idle without anyone pressing End.
    await act(async () => {
      FakeConversationSession.last?.listeners.onStatus('idle');
      FakeConversationSession.last?.listeners.onStopped?.();
      await Promise.resolve();
    });
    expect(latest.conversationId).toBe(before);

    await act(async () => {
      await latest.start(options);
    });
    expect(latest.conversationId).not.toBe(before);
  });

  it('keeps the id after a conversation ends, so the save can still name it', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const during = latest.conversationId;
    await act(async () => {
      latest.stop();
      await Promise.resolve();
    });
    expect(latest.conversationId).toBe(during);
  });

  it('captures the language pair a conversation started with, and keeps it after it ends', async () => {
    // The one thing a caller must NOT be able to do by re-reading its own
    // settings after `stop`: the language pickers stay live once the
    // conversation is idle, so a page holding `settings.languagePair` instead of
    // this captured value would report the wrong language for turns already on
    // screen the moment somebody swapped it.
    expect(latest.languagePair).toBeNull();

    await act(async () => {
      await latest.start(options);
    });
    expect(latest.languagePair).toEqual({ source: 'vi', target: 'en' });

    await act(async () => {
      latest.stop();
      await Promise.resolve();
    });
    expect(latest.languagePair).toEqual({ source: 'vi', target: 'en' });

    await act(async () => {
      await latest.start({ ...options, languagePair: { source: 'en', target: 'vi' } });
    });
    expect(latest.languagePair).toEqual({ source: 'en', target: 'vi' });
  });
});

describe('useStreamingTranslate block retranslation', () => {
  const final = (sessionId: string, sourceText: string, en: string): ServerEvent => ({
    type: 'server.transcript.final',
    sessionId,
    segment: {
      id: `seg-${sessionId}`,
      sessionId,
      speakerRole: 'speaker_a',
      sourceLanguages: ['vi'],
      translations: { en },
      sourceText,
      audioUrl: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });

  it('asks once for a block the ceiling cut, and shows the answer', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const session = FakeConversationSession.last!;
    await act(async () => {
      session.listeners.onTurnCaptured?.({
        sessionId: 'a',
        cutForced: true,
        openedAt: 1_000,
        closedAt: 9_000,
        preRollMs: 0,
      });
      session.listeners.onTurnCaptured?.({
        sessionId: 'b',
        cutForced: false,
        openedAt: 9_130,
        closedAt: 12_000,
        preRollMs: 0,
      });
      session.listeners.onServerEvent(final('a', 'xác thực điện tử', 'authentication'));
      session.listeners.onServerEvent(final('b', 'bắt đầu có hiệu lực', 'It begins'));
      await Promise.resolve();
    });

    expect(session.retranslateBlock).toHaveBeenCalledTimes(1);
    expect(session.retranslateBlock).toHaveBeenCalledWith(['a', 'b']);

    await act(async () => {
      session.listeners.onServerEvent({
        type: 'server.block.translated',
        segmentIds: ['a', 'b'],
        translations: { en: 'authentication takes effect' },
      });
      await Promise.resolve();
    });

    expect(latest.blockTranslations['a b']?.translations.en).toBe('authentication takes effect');
    expect(session.retranslateBlock).toHaveBeenCalledTimes(1);
  });
  // The finishing session waits on this before it closes the socket, so every
  // block the settled transcript holds must already be asked when it resolves.
  it('lets a draining session go only once its blocks are asked', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const session = FakeConversationSession.last!;
    let askedAtRelease: unknown[][] | null = null;
    await act(async () => {
      session.listeners.onTurnCaptured?.({
        sessionId: 'a',
        cutForced: true,
        openedAt: 1_000,
        closedAt: 9_000,
        preRollMs: 0,
      });
      session.listeners.onTurnCaptured?.({
        sessionId: 'b',
        cutForced: false,
        openedAt: 9_130,
        closedAt: 12_000,
        preRollMs: 0,
      });
      session.listeners.onServerEvent(final('a', 'xác thực điện tử', 'authentication'));
      session.listeners.onServerEvent(final('b', 'bắt đầu có hiệu lực', 'It begins'));
      void Promise.resolve(session.listeners.onDrained?.()).then(() => {
        askedAtRelease = [...session.retranslateBlock.mock.calls];
      });
      await Promise.resolve();
    });

    expect(askedAtRelease).toEqual([[['a', 'b']]]);
  });

  it('lets a draining session go when settling changes nothing', async () => {
    await act(async () => {
      await latest.start(options);
    });
    const session = FakeConversationSession.last!;
    let released = false;
    await act(async () => {
      void Promise.resolve(session.listeners.onDrained?.()).then(() => (released = true));
      await Promise.resolve();
    });

    expect(released).toBe(true);
    expect(session.retranslateBlock).not.toHaveBeenCalled();
  });
});

describe('useStreamingTranslate pauses', () => {
  it('reports the paused total once a pause is over, and the open one apart', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await act(async () => {
      await latest.start(options);
    });

    now += 10_000;
    act(() => latest.pause());
    expect(latest.pauses).toEqual([{ startedAt: 1_010_000, endedAt: null }]);
    // Not counted until it closes, so the total does not tick while paused.
    expect(latest.pausedMs).toBe(0);

    now += 5_000;
    act(() => latest.resume());
    expect(latest.pausedMs).toBe(5_000);
    // No recorder ran through the pause, so offsets leave it out too.
    expect(latest.offsetPauses).toEqual(latest.pauses);
  });
});

describe('useStreamingTranslate languages', () => {
  const startIn = async (languagePair: StartOptions['languagePair']) => {
    await act(async () => {
      await latest.start({ ...options, languagePair });
    });
    return FakeConversationSession.last!.startedWith.at(-1);
  };

  it('asks for two-way when the pair can be told apart, and says so', async () => {
    expect(await startIn({ source: 'vi', target: 'en' })).toMatchObject({ twoWay: true });
    expect(latest.twoWayRequested).toBe(true);
  });

  it('never asks two-way from the one-way page, whatever the pair', async () => {
    await act(async () => {
      await latest.start({ ...options, mode: 'one-way' });
    });
    expect(FakeConversationSession.last!.startedWith.at(-1)).not.toHaveProperty('twoWay');
    expect(latest.twoWayRequested).toBe(false);
  });

  it('never asks two-way for an auto-detected source or a pair it cannot identify', async () => {
    expect(await startIn({ source: 'detect', target: 'en' })).not.toHaveProperty('twoWay');
    expect(latest.twoWayRequested).toBe(false);
    expect(await startIn({ source: 'vi', target: 'zh' })).not.toHaveProperty('twoWay');
  });

  it('follows the mode the server answers, and forgets it on the next start', async () => {
    await startIn({ source: 'vi', target: 'en' });
    expect(latest.languageMode).toBeNull();
    act(() => FakeConversationSession.last!.listeners.onLanguageMode?.('declared', 'lid_capacity'));
    expect(latest.languageMode).toEqual({ mode: 'declared', reason: 'lid_capacity' });
    await startIn({ source: 'vi', target: 'en' });
    expect(latest.languageMode).toBeNull();
  });

  it('keeps per-turn modes from the ready events', async () => {
    await startIn({ source: 'vi', target: 'en' });
    act(() =>
      FakeConversationSession.last!.listeners.onServerEvent({
        type: 'server.session.ready',
        sessionId: 's1',
        mode: 'two-way',
      }),
    );
    expect(latest.languageModes).toEqual({ s1: 'two-way' });
  });

  it('says an auto-detect refusal in the reader’s language', async () => {
    await startIn({ source: 'detect', target: 'en' });
    const { listeners } = FakeConversationSession.last!;
    act(() =>
      listeners.onError('Language detection is unavailable', {
        code: 'language_unavailable',
        detail: 'language_detection',
      }),
    );
    expect(latest.error).toBe('web.translate.detectUnavailable');
    act(() => listeners.onError('busy', { code: 'language_unavailable', detail: 'lid_capacity' }));
    expect(latest.error).toBe('web.translate.detectBusy');
    // Anything else keeps the server's own words.
    act(() => listeners.onError('Something else', { code: 'internal' }));
    expect(latest.error).toBe('Something else');
  });
});

describe('useStreamingTranslate credits', () => {
  const started = async () => {
    await act(async () => {
      await latest.start(options);
    });
    return FakeConversationSession.last!;
  };

  /** A credit `server.error`, as the session passes it: the event first, then `onError`. */
  const creditError = (
    session: InstanceType<typeof FakeConversationSession>,
    event: Extract<ServerEvent, { type: 'server.error' }>,
  ) =>
    act(() => {
      session.listeners.onServerEvent(event);
      session.listeners.onError(event.message, { code: event.code });
    });

  it('names the conversation on every turn start through the runtime, a new id per start', async () => {
    const session = await started();
    const first = (session.runtime() as { conversationId?: string }).conversationId;
    expect(first).toBe(latest.conversationId);
    await started();
    const second = (session.runtime() as { conversationId?: string }).conversationId;
    expect(second).toBe(latest.conversationId);
    expect(second).not.toBe(first);
  });

  it('shows running low as a notice, not as the error', async () => {
    const session = await started();
    creditError(session, {
      type: 'server.error',
      code: 'credits_low',
      message: 'Your credits are running low',
      remainingCreditSeconds: 120,
    });
    expect(latest.error).toBeNull();
    expect(latest.notice).toBe('common.billing.low');
    expect(latest.status).toBe('listening');
  });

  it('replaces the notice with the exhausted copy when the balance runs out mid-run', async () => {
    const session = await started();
    creditError(session, {
      type: 'server.error',
      code: 'credits_low',
      message: 'low',
      remainingCreditSeconds: 60,
    });
    creditError(session, {
      type: 'server.error',
      code: 'credits_exhausted',
      message: 'You are out of credits',
      remainingCreditSeconds: 0,
    });
    expect(latest.notice).toBeNull();
    expect(latest.error).toBe('common.billing.exhausted');
  });

  it('says a refused start as needing a credit, and an outage as its own sentence', async () => {
    const session = await started();
    creditError(session, {
      type: 'server.error',
      code: 'credits_exhausted',
      message: 'You are out of credits',
      turnId: 't-1',
      remainingCreditSeconds: 30,
    });
    expect(latest.error).toBe('common.billing.startRefused');
    creditError(session, {
      type: 'server.error',
      code: 'credits_unavailable',
      message: 'cannot check',
      turnId: 't-2',
    });
    expect(latest.error).toBe('common.billing.unavailable');
  });

  it('forgets the notice on the next start', async () => {
    const session = await started();
    creditError(session, {
      type: 'server.error',
      code: 'credits_low',
      message: 'low',
      remainingCreditSeconds: 100,
    });
    await started();
    expect(latest.notice).toBeNull();
  });
});

describe('useStreamingTranslate microphone processing', () => {
  function stubMicrophone(applied: Partial<MicProcessing>) {
    const stream = { getAudioTracks: () => [{ getSettings: () => applied }] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    return getUserMedia;
  }

  async function renderWith(mic: MicProcessing) {
    function MicProbe() {
      const value = useStreamingTranslate(undefined, () => mic);
      React.useEffect(() => {
        latest = value;
      });
      return null;
    }
    await act(async () => {
      root.render(<MicProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await latest.start(options);
    });
    return FakeConversationSession.last!;
  }

  it('opens the microphone with echo cancellation off and runs half duplex', async () => {
    const mic = { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
    const getUserMedia = stubMicrophone(mic);
    const session = await renderWith(mic);
    await session.deps.openMicrophone();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: mic });
    expect(session.runtime().fullDuplex).toBe(false);
  });

  it('opens the microphone with every processor on by default and runs full duplex', async () => {
    const mic = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const getUserMedia = stubMicrophone(mic);
    const session = await renderWith(mic);
    await session.deps.openMicrophone();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: mic });
    expect(session.runtime().fullDuplex).toBe(true);
  });

  it('warns when the browser applied a processor other than the one asked for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    const session = await renderWith({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    });
    await session.deps.openMicrophone();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('echoCancellation'));
  });

  it('reports the paused microphone while half duplex ignores it, and clears it on stop', async () => {
    const session = await renderWith({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    });
    act(() => {
      session.listeners.onMuted(true);
    });
    expect(latest.micPaused).toBe(true);
    await act(async () => {
      latest.stop();
      await Promise.resolve();
    });
    expect(latest.micPaused).toBe(false);
  });
});

describe('playback volume per language', () => {
  /** An `AudioContext` that records every gain stage and what each chunk joined. */
  function fakeAudio() {
    const stages: Array<{ value: number; target: number | null }> = [];
    const connections: number[] = [];
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: () => {
        const stage = { value: 0, target: null as number | null };
        stages.push(stage);
        return {
          context,
          gain: {
            set value(next: number) {
              stage.value = next;
            },
            setTargetAtTime: (next: number) => {
              stage.target = next;
            },
          },
          connect: () => {},
          index: stages.length - 1,
        };
      },
      createBuffer: (_c: number, length: number, rate: number) => ({
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      }),
      createBufferSource: () => ({
        buffer: null,
        onended: null,
        connect: (node: { index: number }) => connections.push(node.index),
        start: () => {},
      }),
    };
    return { context, stages, connections };
  }

  it('gives each language its own stage, read from its own volume, and turns one down alone', async () => {
    const volumes: Record<string, number> = { vi: 0.3, en: 0.8, '': 0.8 };
    function VolumeProbe() {
      const value = useStreamingTranslate((lang) => volumes[lang ?? '']!);
      React.useEffect(() => {
        latest = value;
      });
      return null;
    }
    await act(async () => {
      root.render(<VolumeProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await latest.start(options);
    });
    const deps = FakeConversationSession.last!.deps as unknown as {
      createPlaybackSink: (
        context: unknown,
        onDrained: () => void,
      ) => { enqueue: (key: string, s: Int16Array, rate: number, lang?: string) => void };
    };
    const { context, stages, connections } = fakeAudio();
    const sink = deps.createPlaybackSink(context, () => {});

    sink.enqueue('t1', new Int16Array(160), 16000, 'vi');
    sink.enqueue('t2', new Int16Array(160), 16000, 'en');
    sink.enqueue('t3', new Int16Array(160), 16000, 'vi');

    expect(stages.map((stage) => stage.value)).toEqual([0.3, 0.8]);
    expect(connections).toEqual([0, 1, 0]);

    latest.setVolume(0.1, 'vi');
    expect(stages[0]!.target).toBe(0.1);
    expect(stages[1]!.target).toBeNull();
  });
});
