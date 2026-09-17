// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';

/**
 * The two rules a stale or empty library must obey.
 *
 * A failed request must leave a RENDERABLE state rather than throwing, and a
 * selection naming a context that no longer exists must read as "no context" —
 * the same reconciliation rule `loadTranslateSettings` records for the voice
 * token, applied at the point of use because that is where the list has
 * resolved.
 *
 * `toHints` is asserted on the OMISSIONS. Sending `{}` instead of `undefined`, or
 * `glossary: []` instead of nothing, changes the prompt for a user who selected
 * nothing — which is exactly the path the recorded injection baseline describes.
 */

const listTranslationContexts = vi.hoisted(() => vi.fn());
const saveTranslationContext = vi.hoisted(() => vi.fn());
const deleteTranslationContext = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({
  listTranslationContexts,
  saveTranslationContext,
  deleteTranslationContext,
}));

import {
  resolveContext,
  toHints,
  TranslationContextsProvider,
  useTranslationContexts,
} from './use-translation-contexts';

const context = (over: Partial<TranslationContext> = {}): TranslationContext => ({
  id: 'ctx-1',
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useTranslationContexts>;
let latestA: ReturnType<typeof useTranslationContexts>;
let latestB: ReturnType<typeof useTranslationContexts>;

function Probe() {
  const value = useTranslationContexts();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function ProbeA() {
  const value = useTranslationContexts();
  React.useEffect(() => {
    latestA = value;
  });
  return null;
}

function ProbeB() {
  const value = useTranslationContexts();
  React.useEffect(() => {
    latestB = value;
  });
  return null;
}

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
    // Settles the list promise inside the same `act`, so the state it writes is
    // committed before an assertion reads it.
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listTranslationContexts.mockReset();
  saveTranslationContext.mockReset();
  deleteTranslationContext.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useTranslationContexts', () => {
  it('loads the list', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });

    await render(<Probe />);

    expect(latest.status).toBe('ready');
    expect(latest.contexts.map((c) => c.id)).toEqual(['ctx-1']);
  });

  it('leaves the list empty and reports a failure, without throwing', async () => {
    listTranslationContexts.mockRejectedValue(new Error('offline'));

    await render(<Probe />);

    // `failed`, not `ready` with nothing in it: an unreachable API must not look
    // like an account that has authored no contexts.
    expect(latest.status).toBe('failed');
    expect(latest.contexts).toEqual([]);
  });

  it('refetches the list after a save', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });
    saveTranslationContext.mockResolvedValue({ context: context() });

    await render(<Probe />);
    listTranslationContexts.mockResolvedValue({
      contexts: [context(), context({ id: 'ctx-2', name: 'Standup' })],
    });

    await act(async () => {
      await latest.save('ctx-2', {
        name: 'Standup',
        topic: null,
        hotwords: [],
        glossary: [],
        style: null,
      });
    });

    // The refetch rather than a local splice: the server owns `updatedAt`, which
    // is the list's sort key.
    expect(listTranslationContexts).toHaveBeenCalledTimes(2);
    expect(latest.contexts.map((c) => c.id)).toEqual(['ctx-1', 'ctx-2']);
  });
});

describe('resolveContext', () => {
  it('returns null for an id that is not in the list', () => {
    // The stale-reference rule: a deleted context reads as "no context" rather
    // than as an error, so the panel still renders.
    expect(resolveContext([context()], 'ctx-gone')).toBeNull();
  });

  it('returns null for no selection at all', () => {
    expect(resolveContext([context()], null)).toBeNull();
  });

  it('returns the matching context', () => {
    expect(resolveContext([context()], 'ctx-1')?.name).toBe('Thesis defense');
  });
});

describe('toHints', () => {
  it('returns undefined for no selection', () => {
    expect(toHints(null)).toBeUndefined();
  });

  it('returns undefined for a context with nothing in it but a name', () => {
    // A name is a label for the picker, not a hint. A context carrying only one
    // must produce the same prompt as no context at all.
    expect(toHints(context())).toBeUndefined();
  });

  it('omits an empty glossary rather than sending []', () => {
    const hints = toHints(context({ topic: 'thesis defense' }));
    expect(hints).toEqual({ topic: 'thesis defense' });
    expect(hints && 'glossary' in hints).toBe(false);
  });

  it('carries vi/en pairs through unchanged', () => {
    // Untouched, and not re-keyed by direction: which side is the source is
    // resolved server-side, because only the session knows its direction.
    const glossary = [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }];
    expect(toHints(context({ glossary }))?.glossary).toEqual(glossary);
  });
});

/**
 * `/preferences` mounts two readers of the same library side by side: the
 * editor, and the picker in the defaults panel below it. Each calling
 * `useTranslationContexts` on its own meant two independent GETs and two copies
 * of the list — a context created in one was invisible to the other until ITS
 * OWN unrelated refetch happened to run.
 */
describe('TranslationContextsProvider', () => {
  it('shares one fetch between every mount underneath it', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });

    await render(
      <TranslationContextsProvider>
        <ProbeA />
        <ProbeB />
      </TranslationContextsProvider>,
    );

    expect(listTranslationContexts).toHaveBeenCalledTimes(1);
    expect(latestA.status).toBe('ready');
    expect(latestA.contexts.map((c) => c.id)).toEqual(['ctx-1']);
    expect(latestB.contexts.map((c) => c.id)).toEqual(['ctx-1']);
  });

  it('makes a write in one mount visible to the other, without its own refetch', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });
    saveTranslationContext.mockResolvedValue({ context: context() });

    await render(
      <TranslationContextsProvider>
        <ProbeA />
        <ProbeB />
      </TranslationContextsProvider>,
    );

    listTranslationContexts.mockResolvedValue({
      contexts: [context(), context({ id: 'ctx-2', name: 'Standup' })],
    });
    await act(async () => {
      await latestA.save('ctx-2', {
        name: 'Standup',
        topic: null,
        hotwords: [],
        glossary: [],
        style: null,
      });
    });

    // `latestB` never called `save` or `reload` itself — it sees the new row
    // because the two share one state, not because it happened to refetch too.
    expect(latestB.contexts.map((c) => c.id)).toEqual(['ctx-1', 'ctx-2']);
  });

  it('does not affect a mount with no provider above it', async () => {
    // `/translate` never wraps `CascadePanel` in this provider — its own,
    // per-mount fetch must still be exactly what it was.
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });

    await render(<Probe />);

    expect(listTranslationContexts).toHaveBeenCalledTimes(1);
    expect(latest.contexts.map((c) => c.id)).toEqual(['ctx-1']);
  });
});
