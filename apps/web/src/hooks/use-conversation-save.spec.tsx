// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';
import type { ConversationTurn, SaveConversationRequest } from '@chatofy/types';
import {
  useConversationSave,
  type ConversationSaveInput,
  type UseConversationSave,
} from './use-conversation-save';

/**
 * When a finished conversation is written, and how a failure is classified.
 *
 * Both are invisible in the UI and both are load-bearing: a save that never
 * fires loses the conversation silently, and a failure classified as retryable
 * when it is not offers a button that can never succeed.
 */

const saveConversation = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({ saveConversation }));

let container: HTMLDivElement;
let root: Root;
let latest: UseConversationSave;

const turn = (text: string, speakerLabel: string | null = null): ConversationTurn => ({
  position: 0,
  speakerRole: 'speaker_a',
  speakerLabel,
  sourceText: text,
  displayText: null,
  targetText: 'translated',
  offsetMs: null,
});

const baseInput: ConversationSaveInput = {
  conversationId: 'c-1',
  startedAt: '2026-09-03T00:00:00.000Z',
  direction: 'vi_to_en',
  running: true,
  turns: [],
};

/** The body of the nth write. `mock.calls` is untyped, and the assertions are not. */
function bodyOf(call: number): SaveConversationRequest {
  return saveConversation.mock.calls[call]?.[1] as SaveConversationRequest;
}

function Probe({ input }: { input: ConversationSaveInput }) {
  const value = useConversationSave(input);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

/** Renders (or re-renders) with the given input and flushes effects. */
async function render(input: ConversationSaveInput): Promise<void> {
  await act(async () => {
    root.render(<Probe input={input} />);
    // Lets the promises the effects queued settle before the assertions
    // read state back — which is what makes this `act` async at all.
    await Promise.resolve();
  });
}

/**
 * Lets an edit's coalescing delay elapse. Comfortably past it, so the test does
 * not encode the exact delay the hook picked.
 */
async function flushEdits(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // Edits to a stored conversation are written on a timer, so the tests own the
  // clock rather than waiting on it.
  vi.useFakeTimers();
  saveConversation.mockReset();
  saveConversation.mockResolvedValue({ conversation: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useConversationSave', () => {
  it('fires once when a conversation with blocks goes idle', async () => {
    await render({ ...baseInput, running: true, turns: [turn('xin chào')] });
    expect(saveConversation).not.toHaveBeenCalled();

    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });

    expect(saveConversation).toHaveBeenCalledTimes(1);
    expect(saveConversation).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ direction: 'vi_to_en', startedAt: baseInput.startedAt }),
    );
    expect(latest.saved).toBe(true);
    expect(latest.failure).toBeNull();

    // A re-render with the same content must not spend a second write.
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(saveConversation).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a conversation with no blocks', async () => {
    await render({ ...baseInput, running: false, turns: [] });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(latest.saved).toBe(false);
  });

  it('re-saves after a roster edit, because the write is a replacement', async () => {
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(saveConversation).toHaveBeenCalledTimes(1);

    await render({ ...baseInput, running: false, turns: [turn('xin chào', 'An')] });
    await flushEdits();
    expect(saveConversation).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).turns[0]?.speakerLabel).toBe('An');
  });

  it('coalesces a burst of name keystrokes into one write', async () => {
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(saveConversation).toHaveBeenCalledTimes(1);

    for (const label of ['A', 'An', 'Anh']) {
      await render({ ...baseInput, running: false, turns: [turn('xin chào', label)] });
    }
    // Typing three characters is not three replacements of the whole transcript.
    expect(saveConversation).toHaveBeenCalledTimes(1);

    await flushEdits();
    expect(saveConversation).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).turns[0]?.speakerLabel).toBe('Anh');
  });

  it('writes an edit that was still waiting when the screen went away', async () => {
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    await render({ ...baseInput, running: false, turns: [turn('xin chào', 'An')] });
    expect(saveConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    expect(saveConversation).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).turns[0]?.speakerLabel).toBe('An');

    root = createRoot(container);
  });

  it('reports the same ending instant on a re-save, whenever the edit happens', async () => {
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    const first = bodyOf(0).endedAt;

    // Half an hour of reading before somebody names a speaker. The stored
    // conversation lasted as long as it lasted.
    vi.advanceTimersByTime(30 * 60_000);
    await render({ ...baseInput, running: false, turns: [turn('xin chào', 'An')] });
    await flushEdits();

    expect(bodyOf(1).endedAt).toBe(first);
  });

  it('keeps a stored conversation saved when a later edit fails', async () => {
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(latest.saved).toBe(true);

    saveConversation.mockRejectedValueOnce(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: 'down' }, 503),
    );
    await render({ ...baseInput, running: false, turns: [turn('xin chào', 'An')] });
    await flushEdits();

    // The row is in the database; only the rename is not.
    expect(latest.saved).toBe(true);
    expect(latest.failure).toBe('retryable');
  });

  it('does not write the outcome of one conversation onto the next', async () => {
    let releaseFirst: () => void = () => {};
    saveConversation.mockImplementationOnce(
      () =>
        new Promise<{ conversation: unknown }>((resolve) => {
          releaseFirst = () => resolve({ conversation: {} });
        }),
    );

    await render({ ...baseInput, running: false, turns: [turn('first')] });
    // A second conversation starts before the first one's write lands.
    await render({ ...baseInput, conversationId: 'c-2', running: true, turns: [] });
    expect(latest.saved).toBe(false);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });

    // Still unsaved: what landed was the previous conversation's row.
    expect(latest.saved).toBe(false);
  });

  it('does not carry a save still in flight into the conversation that follows', async () => {
    let releaseFirst: () => void = () => {};
    saveConversation.mockImplementationOnce(
      () =>
        new Promise<{ conversation: unknown }>((resolve) => {
          releaseFirst = () => resolve({ conversation: {} });
        }),
    );

    await render({ ...baseInput, running: false, turns: [turn('first')] });
    expect(latest.saving).toBe(true);

    await render({ ...baseInput, conversationId: 'c-2', running: true, turns: [] });
    // The write belongs to the conversation that was left, and its completion
    // refuses to touch state that now describes another one — so nothing else
    // would ever put this down, and the new conversation would read as saving
    // for the whole of its life.
    expect(latest.saving).toBe(false);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });
    expect(latest.saving).toBe(false);
  });

  it('classifies a 400 as terminal and refuses to retry it', async () => {
    saveConversation.mockRejectedValue(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'too long' }, 400),
    );

    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });

    expect(latest.failure).toBe('terminal');
    expect(latest.saved).toBe(false);

    await act(async () => {
      latest.retry();
      await Promise.resolve();
    });
    // Still one: the same body can never succeed, so a retry is a lie.
    expect(saveConversation).toHaveBeenCalledTimes(1);
  });

  it('classifies a 503 as retryable, and the retry can succeed', async () => {
    saveConversation.mockRejectedValueOnce(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: 'down' }, 503),
    );

    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(latest.failure).toBe('retryable');

    await act(async () => {
      latest.retry();
      await Promise.resolve();
    });
    expect(saveConversation).toHaveBeenCalledTimes(2);
    expect(latest.saved).toBe(true);
    expect(latest.failure).toBeNull();
  });

  it('treats an unrecognized failure as retryable rather than abandoning it', async () => {
    saveConversation.mockRejectedValue(new Error('something odd'));
    await render({ ...baseInput, running: false, turns: [turn('xin chào')] });
    expect(latest.failure).toBe('retryable');
  });

  it('queues a save requested mid-flight rather than racing it', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    saveConversation
      .mockImplementationOnce(
        () =>
          new Promise<{ conversation: unknown }>((resolve) => {
            order.push('first:start');
            releaseFirst = () => {
              order.push('first:end');
              resolve({ conversation: {} });
            };
          }),
      )
      .mockImplementationOnce(() => {
        order.push('second:start');
        return Promise.resolve({ conversation: {} });
      });

    await render({ ...baseInput, running: false, turns: [turn('one')] });
    // Requested while the first is still open.
    await render({ ...baseInput, running: false, turns: [turn('one', 'An')] });
    await flushEdits();
    expect(order).toEqual(['first:start']);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('starts a new conversation unsaved when the id is re-minted', async () => {
    await render({ ...baseInput, running: false, turns: [turn('first')] });
    expect(latest.saved).toBe(true);

    await render({
      ...baseInput,
      conversationId: 'c-2',
      running: true,
      turns: [],
    });
    expect(latest.saved).toBe(false);
  });

  it('saves on unmount when a finished conversation was never stored', async () => {
    // A route change away from a conversation whose save never fired.
    await render({ ...baseInput, running: true, turns: [turn('xin chào')] });
    expect(saveConversation).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(saveConversation).toHaveBeenCalledTimes(1);

    // Re-created so the shared afterEach unmount is harmless.
    root = createRoot(container);
  });
});
