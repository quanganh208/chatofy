// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, SessionOptions } from '@chatofy/types';
import type { ConversationSessionListeners } from '@chatofy/realtime-client';
import { useStreamingTranslate, type UseStreamingTranslate } from './use-streaming-translate';

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

    constructor(_deps: unknown, listeners: ConversationSessionListeners) {
      this.listeners = listeners;
      Fake.last = this;
    }

    start = (): Promise<void> => {
      this.listeners.onReset();
      this.listeners.onStatus('listening');
      return Promise.resolve();
    };

    stop = (): void => {
      this.listeners.onStatus('idle');
      this.listeners.onStopped?.();
    };

    retranslateBlock = vi.fn();
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

const options: SessionOptions = { direction: 'vi_to_en', voiceGender: 'female' };

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

  it('captures the direction a conversation started with, and keeps it after it ends', async () => {
    // The one thing a caller must NOT be able to do by re-reading its own
    // settings after `stop`: the direction toggle stays live once the
    // conversation is idle, so a page holding `settings.direction` instead of
    // this captured value would report the wrong language for turns already on
    // screen the moment somebody swapped it.
    expect(latest.direction).toBeNull();

    await act(async () => {
      await latest.start(options);
    });
    expect(latest.direction).toBe('vi_to_en');

    await act(async () => {
      latest.stop();
      await Promise.resolve();
    });
    expect(latest.direction).toBe('vi_to_en');

    await act(async () => {
      await latest.start({ ...options, direction: 'en_to_vi' });
    });
    expect(latest.direction).toBe('en_to_vi');
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
      direction: 'vi_to_en',
      sourceLanguages: ['vi'],
      translations: { en },
      sourceText,
      targetText: en,
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
});
