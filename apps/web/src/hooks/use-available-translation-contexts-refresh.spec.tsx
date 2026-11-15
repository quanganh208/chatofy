// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';

/**
 * The picker list follows library writes made in the same tab: an edit in Settings
 * over `/translate` must reach the picker, and a background refetch that fails must
 * not take the picker away.
 */

const listAvailableTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listAvailableTranslationContexts: () => listAvailableTranslationContexts(),
}));

const { useAvailableTranslationContexts } = await import('./use-available-translation-contexts');
const { notifyLibraryChanged } = await import('@/lib/library-changed');
const { LocaleProvider } = await import('@/i18n/provider');

const context = (id: string): TranslationContext => ({
  id,
  name: id,
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  glossaryId: null,
  linkedGlossaryId: null,
  linkedGlossaryName: null,
  updatedAt: '2026-11-15T00:00:00.000Z',
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useAvailableTranslationContexts>;

function Probe() {
  const value = useAvailableTranslationContexts();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listAvailableTranslationContexts.mockReset();
  listAvailableTranslationContexts.mockResolvedValueOnce({ personal: [context('a')], teams: [] });
  act(() =>
    root.render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    ),
  );
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useAvailableTranslationContexts — after a library write', () => {
  it('refetches and shows the new list', async () => {
    listAvailableTranslationContexts.mockResolvedValueOnce({
      personal: [context('a'), context('b')],
      teams: [],
    });
    act(() => notifyLibraryChanged());
    await flush();

    expect(latest.all.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('keeps the list it had when the refetch fails', async () => {
    listAvailableTranslationContexts.mockRejectedValueOnce(new Error('offline'));
    act(() => notifyLibraryChanged());
    await flush();

    expect(latest.status).toBe('ready');
    expect(latest.all.map((c) => c.id)).toEqual(['a']);
  });

  it('stops listening once unmounted', async () => {
    act(() => root.unmount());
    root = createRoot(container);
    notifyLibraryChanged();
    await flush();

    expect(listAvailableTranslationContexts).toHaveBeenCalledTimes(1);
  });
});

describe('useAvailableTranslationContexts — a write during the first read', () => {
  it('reports failed, not loading, when the refetch that superseded it fails', async () => {
    act(() => root.unmount());
    root = createRoot(container);
    let failFirst!: (err: Error) => void;
    listAvailableTranslationContexts.mockReset();
    listAvailableTranslationContexts.mockReturnValueOnce(
      new Promise((_, reject) => (failFirst = reject)),
    );
    listAvailableTranslationContexts.mockRejectedValueOnce(new Error('offline'));
    act(() =>
      root.render(
        <LocaleProvider>
          <Probe />
        </LocaleProvider>,
      ),
    );
    act(() => notifyLibraryChanged());
    await flush();
    failFirst(new Error('offline'));
    await flush();

    expect(latest.status).toBe('failed');
  });
});
