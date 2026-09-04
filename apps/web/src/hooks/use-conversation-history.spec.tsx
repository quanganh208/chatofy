// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { useConversationHistory, type UseConversationHistory } from './use-conversation-history';

/**
 * Two ways a paged, searchable list can show the reader something untrue: a page
 * fetched against one list landing in another, and a failed page erasing the
 * rows that did arrive. Neither is visible in a single request's happy path,
 * which is why they are exercised here rather than through the screen.
 */

const listConversations = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({ listConversations }));

let container: HTMLDivElement;
let root: Root;
let latest: UseConversationHistory;

const summary = (id: string): ConversationSummary => ({
  conversationId: id,
  direction: 'vi_to_en',
  startedAt: '2026-09-03T10:00:00.000Z',
  endedAt: '2026-09-03T10:10:00.000Z',
  turnCount: 4,
  preview: id,
  hasMinutes: false,
});

const ids = (): string[] => latest.conversations.map((c) => c.conversationId);

/** A promise this test resolves or rejects when it chooses to. */
function deferred<T>() {
  let settle!: { resolve: (value: T) => void; reject: (reason: unknown) => void };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Attached now so a rejection settled before the hook's own handler runs is
  // never an unhandled rejection in the test process.
  promise.catch(() => {});
  return { promise, ...settle };
}

function Probe({ q }: { q: string }) {
  const value = useConversationHistory(q);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

/** Renders with the given term and lets the queued promises settle. */
async function render(q = ''): Promise<void> {
  await act(async () => {
    root.render(<Probe q={q} />);
    await flushMicrotasks();
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
  });
}

/** The request chains are `.then().catch().finally()`, so one tick is not enough. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  listConversations.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('useConversationHistory', () => {
  it('clears the rows on retry, but not on a keystroke', async () => {
    // Two paths through the same effect, deliberately different. A keystroke keeps
    // its rows — losing your place mid-search is the thing that was fixed. A retry
    // is a press after seeing an error, and the rows it would keep belong to a
    // query that is no longer in the box.
    const retried = deferred<{
      conversations: ConversationSummary[];
      nextCursor: string | null;
    }>();
    listConversations
      .mockResolvedValueOnce({ conversations: [summary('a1')], nextCursor: null })
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retried.promise);

    await render('');
    expect(ids()).toEqual(['a1']);

    // A search that fails. The rows are still there behind the error.
    await render('xin');
    expect(latest.error).toBe(true);
    expect(ids()).toEqual(['a1']);

    await act(async () => {
      latest.reload();
      await flushMicrotasks();
    });
    expect(ids(), 'retry starts clean').toEqual([]);

    await act(async () => {
      retried.resolve({ conversations: [summary('b1')], nextCursor: null });
      await flushMicrotasks();
    });
    expect(ids()).toEqual(['b1']);
  });

  it('does not carry a cursor across a search term change', async () => {
    // A cursor belongs to one list. Held across a term change it is a request for
    // the OLD keyset under the NEW query, and the `activeList` guard cannot catch
    // it: the ref is already the new key by the time the click happens. Dropping
    // the cursor also drops `hasMore`, so the control is not offered meanwhile.
    const firstPage = deferred<{
      conversations: ConversationSummary[];
      nextCursor: string | null;
    }>();
    listConversations
      .mockResolvedValueOnce({ conversations: [summary('a1')], nextCursor: 'cur-1' })
      .mockReturnValueOnce(firstPage.promise);

    await render('');
    expect(latest.hasMore).toBe(true);

    // A new term. Its first page has not landed yet.
    await render('xin');
    expect(latest.hasMore, 'the old cursor must not survive the term change').toBe(false);

    // Rows from the previous term are still on screen — that is the deliberate
    // trade — but nothing offers to page the list they came from.
    expect(ids()).toEqual(['a1']);

    await act(async () => {
      firstPage.resolve({ conversations: [summary('b1')], nextCursor: 'cur-2' });
      await flushMicrotasks();
    });
    expect(ids()).toEqual(['b1']);
    expect(latest.hasMore).toBe(true);
  });

  it('drops a page fetched before the search term changed', async () => {
    const unfilteredPage2 = deferred<{
      conversations: ConversationSummary[];
      nextCursor: string | null;
    }>();
    listConversations
      .mockResolvedValueOnce({ conversations: [summary('a1')], nextCursor: 'cur-1' })
      .mockReturnValueOnce(unfilteredPage2.promise)
      .mockResolvedValueOnce({ conversations: [summary('match')], nextCursor: null });

    await render('');
    expect(ids()).toEqual(['a1']);

    // "Load more" on the unfiltered list, then a search before it lands.
    await act(async () => {
      latest.loadMore();
      await Promise.resolve();
    });
    await render('anh');
    expect(ids()).toEqual(['match']);

    await act(async () => {
      unfilteredPage2.resolve({ conversations: [summary('a2')], nextCursor: 'cur-2' });
      await flushMicrotasks();
    });

    // `a2` does not match what is being searched for, and `cur-2` is the other
    // list's cursor.
    expect(ids()).toEqual(['match']);
    expect(latest.hasMore).toBe(false);
  });

  it('keeps the loaded conversations on screen when a further page fails', async () => {
    const page2 = deferred<never>();
    listConversations
      .mockResolvedValueOnce({ conversations: [summary('a1'), summary('a2')], nextCursor: 'cur-1' })
      .mockReturnValueOnce(page2.promise);

    await render('');

    await act(async () => {
      latest.loadMore();
      await Promise.resolve();
    });
    await act(async () => {
      page2.reject(new Error('offline'));
      await flushMicrotasks();
    });

    expect(ids()).toEqual(['a1', 'a2']);
    // The first page is fine, so the screen must not claim the history failed.
    expect(latest.error).toBe(false);
    expect(latest.loadMoreError).toBe(true);
    expect(latest.loadingMore).toBe(false);
  });

  it('reports a failed first page as an error rather than an empty history', async () => {
    listConversations.mockRejectedValueOnce(new Error('offline'));

    await render('');

    expect(latest.error).toBe(true);
    expect(latest.loadMoreError).toBe(false);
    expect(ids()).toEqual([]);
  });

  it('does not search a term below the minimum, and lists everything instead', async () => {
    listConversations.mockResolvedValue({ conversations: [summary('a1')], nextCursor: null });

    await render('a');

    expect(listConversations).toHaveBeenCalledWith({ q: '' });
    expect(latest.searching).toBe(false);
  });

  it('re-fetches the first page on reload and clears a previous next-page failure', async () => {
    const page2 = deferred<never>();
    listConversations
      .mockResolvedValueOnce({ conversations: [summary('a1')], nextCursor: 'cur-1' })
      .mockReturnValueOnce(page2.promise)
      .mockResolvedValueOnce({ conversations: [summary('b1')], nextCursor: null });

    await render('');
    await act(async () => {
      latest.loadMore();
      await Promise.resolve();
    });
    await act(async () => {
      page2.reject(new Error('offline'));
      await flushMicrotasks();
    });
    expect(latest.loadMoreError).toBe(true);

    await act(async () => {
      latest.reload();
      await flushMicrotasks();
    });
    await settle();

    expect(ids()).toEqual(['b1']);
    expect(latest.loadMoreError).toBe(false);
  });
});
