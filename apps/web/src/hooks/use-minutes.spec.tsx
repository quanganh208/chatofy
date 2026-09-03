// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingMinutes } from '@chatofy/types';
import { useMinutes, type UseMinutes } from './use-minutes';

/**
 * Which summarization pass is allowed to write.
 *
 * A pass takes seconds and the conversation it summarizes can stop being the one
 * on screen while it runs. Nothing in the UI shows which pass a result came
 * from, which is exactly why it has to be settled here.
 */

const generateMinutes = vi.hoisted(() => vi.fn());
const getMinutes = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({ generateMinutes, getMinutes }));

let container: HTMLDivElement;
let root: Root;
let latest: UseMinutes;

const minutesFor = (conversationId: string): MeetingMinutes => ({
  conversationId,
  status: 'ready',
  summary: `summary of ${conversationId}`,
  keyPoints: [],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-09-03T00:00:00.000Z',
  model: 'gemini-3.5-flash',
});

/** A response held open, so a pass can be superseded while it is in flight. */
function deferred(): { promise: Promise<{ minutes: MeetingMinutes }>; settle: () => void } {
  let settle = (): void => {};
  const promise = new Promise<{ minutes: MeetingMinutes }>((resolve) => {
    settle = () => resolve({ minutes: minutesFor('a') });
  });
  return { promise, settle };
}

function Probe() {
  const value = useMinutes();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

/** Lets the promises a call queued settle before the assertions read state. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  generateMinutes.mockReset();
  getMinutes.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useMinutes', () => {
  it('keeps the result of a pass that was not superseded', async () => {
    generateMinutes.mockResolvedValue({ minutes: minutesFor('a') });

    await act(async () => {
      await latest.generate('a');
    });

    expect(latest.minutes?.conversationId).toBe('a');
    expect(latest.loading).toBe(false);
    expect(latest.error).toBe(false);
  });

  it('discards a pass the conversation moved on from', async () => {
    // Generate on the first conversation, start a second one — which is what
    // resets the panel — and only then let the first pass answer. Landing it
    // would show the first conversation's summary under a Regenerate button
    // aimed at the second.
    const first = deferred();
    generateMinutes.mockReturnValue(first.promise);

    act(() => {
      void latest.generate('a');
    });
    act(() => {
      latest.reset();
    });
    first.settle();
    await flush();

    expect(latest.minutes).toBeNull();
    // And nothing is left claiming to be running, or the panel would generate
    // forever for a conversation nobody asked about.
    expect(latest.loading).toBe(false);
  });

  it('discards a failure from a pass the conversation moved on from', async () => {
    generateMinutes.mockRejectedValue(new Error('network'));

    act(() => {
      void latest.generate('a');
    });
    act(() => {
      latest.reset();
    });
    await flush();

    expect(latest.error).toBe(false);
    expect(latest.loading).toBe(false);
  });

  it('lets the newest pass own the state when an older one answers first', async () => {
    const older = deferred();
    generateMinutes.mockReturnValueOnce(older.promise);
    generateMinutes.mockReturnValueOnce(Promise.resolve({ minutes: minutesFor('b') }));

    act(() => {
      void latest.generate('a');
    });
    act(() => {
      void latest.generate('b');
    });
    older.settle();
    await flush();

    expect(latest.minutes?.conversationId).toBe('b');
    expect(latest.loading).toBe(false);
  });
});
