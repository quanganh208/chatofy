// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlossaryItem } from '@chatofy/types';
import { useGlossaryItems, type GlossaryItemsValue } from './use-glossary-items';

/**
 * Whose items the panel shows.
 *
 * A read takes a round trip and the selected glossary can change while it is
 * out. Every term looks alike on screen, so a list painted under the wrong
 * glossary would be believed — which is why it has to be settled here.
 */

const listGlossaryItems = vi.hoisted(() => vi.fn());
const addGlossaryItem = vi.hoisted(() => vi.fn());
const deleteGlossaryItem = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({
  listGlossaryItems,
  addGlossaryItem,
  deleteGlossaryItem,
}));

let container: HTMLDivElement;
let root: Root;
let latest: GlossaryItemsValue;

const itemFor = (glossaryId: string): GlossaryItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  glossaryId,
  original: `term of ${glossaryId}`,
  translation: 'rendering',
  targetLang: 'en',
  notes: null,
  createdAt: '2026-10-27T00:00:00.000Z',
});

/** A reply held open, so the selection can move while it is in flight. */
function deferred(glossaryId: string): {
  promise: Promise<{ items: GlossaryItem[] }>;
  settle: () => void;
} {
  let settle = (): void => {};
  const promise = new Promise<{ items: GlossaryItem[] }>((resolve) => {
    settle = () => resolve({ items: [itemFor(glossaryId)] });
  });
  return { promise, settle };
}

function Probe({ glossaryId }: { glossaryId: string | null }) {
  const value = useGlossaryItems(glossaryId);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function select(glossaryId: string | null): void {
  act(() => {
    root.render(<Probe glossaryId={glossaryId} />);
  });
}

/** Lets the promises a call queued settle before the assertions read state. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  listGlossaryItems.mockReset();
  addGlossaryItem.mockReset();
  deleteGlossaryItem.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useGlossaryItems', () => {
  it('asks for nothing while no glossary is selected', () => {
    select(null);

    expect(latest.status).toBe('idle');
    expect(latest.items).toEqual([]);
    expect(listGlossaryItems).not.toHaveBeenCalled();
  });

  it('is loading until the read lands, then ready with its items', async () => {
    const reply = deferred('a');
    listGlossaryItems.mockReturnValue(reply.promise);

    select('a');
    expect(latest.status).toBe('loading');

    reply.settle();
    await flush();

    expect(latest.status).toBe('ready');
    expect(latest.items).toEqual([itemFor('a')]);
  });

  it('reports a failed read as failed with no items', async () => {
    listGlossaryItems.mockRejectedValue(new Error('offline'));

    select('a');
    await flush();

    expect(latest.status).toBe('failed');
    expect(latest.items).toEqual([]);
  });

  it('never shows the previous glossary’s items under a new selection', async () => {
    listGlossaryItems.mockResolvedValueOnce({ items: [itemFor('a')] });
    select('a');
    await flush();

    const replyForB = deferred('b');
    listGlossaryItems.mockReturnValueOnce(replyForB.promise);
    select('b');

    expect(latest.status).toBe('loading');
    expect(latest.items).toEqual([]);
  });

  it('drops a reply for a glossary that is no longer selected', async () => {
    const replyForA = deferred('a');
    listGlossaryItems.mockReturnValueOnce(replyForA.promise);
    select('a');

    listGlossaryItems.mockResolvedValueOnce({ items: [itemFor('b')] });
    select('b');
    await flush();

    replyForA.settle();
    await flush();

    expect(latest.status).toBe('ready');
    expect(latest.items).toEqual([itemFor('b')]);
  });

  it('drops a reload that lands after the user moved to another glossary', async () => {
    listGlossaryItems.mockResolvedValueOnce({ items: [] });
    select('a');
    await flush();

    // Adding a term reloads the list; that reload is still out when the
    // selection moves on.
    addGlossaryItem.mockResolvedValue({ item: itemFor('a') });
    const reloadForA = deferred('a');
    listGlossaryItems.mockReturnValueOnce(reloadForA.promise);
    let adding: Promise<void> = Promise.resolve();
    await act(async () => {
      adding = latest.addItem({
        clientId: '00000000-0000-4000-8000-000000000002',
        original: 'term',
        translation: 'rendering',
        targetLang: 'en',
        notes: null,
      });
      await Promise.resolve();
    });

    listGlossaryItems.mockResolvedValueOnce({ items: [itemFor('b')] });
    select('b');
    await flush();

    reloadForA.settle();
    await act(async () => {
      await adding;
    });

    expect(latest.items).toEqual([itemFor('b')]);
  });
});
