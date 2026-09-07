// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationDirection } from '@chatofy/types';
import type { VoiceCatalogState } from './use-voice-catalog';

/**
 * How often the voice list is asked for, which is the whole point of the cache.
 *
 * The panel reading this hook sits inside a popover, and popover content unmounts
 * on close — so without a cache "open the voice group" IS "call the endpoint", and
 * a reader comparing options a few times spends a call per glance on an answer
 * that cannot have changed.
 */

const listVoices = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({ listVoices }));

let container: HTMLDivElement;
let root: Root;
let latest: VoiceCatalogState;

// A fresh module per test: the cache lives in module scope, so leaving it in place
// would make each test depend on the ones before it.
async function loadHook() {
  vi.resetModules();
  return (await import('./use-voice-catalog')).useVoiceCatalog;
}

function probeFor(useVoiceCatalog: (direction: TranslationDirection) => VoiceCatalogState) {
  return function Probe({ direction }: { direction: TranslationDirection }) {
    const value = useVoiceCatalog(direction);
    React.useEffect(() => {
      latest = value;
    });
    return null;
  };
}

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
    // Settles the catalog promise inside the same `act`, so the state it writes is
    // committed before an assertion reads it.
    await Promise.resolve();
  });
}

const voice = (token: string) => ({ token, label: token, gender: 'female' as const });

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listVoices.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useVoiceCatalog', () => {
  it('asks once however many times the popover is opened', async () => {
    listVoices.mockResolvedValue({ voices: [voice('en-a')] });
    const Probe = probeFor(await loadHook());

    await render(<Probe direction="vi_to_en" />);
    expect(latest).toEqual({ status: 'ready', voices: [voice('en-a')] });

    // Closing and reopening the popover, which is a full unmount and remount.
    await render(<></>);
    await render(<Probe direction="vi_to_en" />);

    expect(listVoices).toHaveBeenCalledTimes(1);
    // And straight to the list, with no "loading" frame in between.
    expect(latest).toEqual({ status: 'ready', voices: [voice('en-a')] });
  });

  it('asks again for a language it has not listed yet', async () => {
    listVoices.mockImplementation((language: 'vi' | 'en') =>
      Promise.resolve({ voices: [voice(`${language}-a`)] }),
    );
    const Probe = probeFor(await loadHook());

    await render(<Probe direction="vi_to_en" />);
    await render(<Probe direction="en_to_vi" />);

    expect(listVoices).toHaveBeenCalledTimes(2);
    expect(listVoices).toHaveBeenLastCalledWith('vi');
    expect(latest).toEqual({ status: 'ready', voices: [voice('vi-a')] });
  });

  it('retries after a failure rather than pinning it for the life of the tab', async () => {
    // A stopped sidecar or an expired session is the usual cause, and both get
    // fixed while the tab stays open — so only a success is worth remembering.
    listVoices.mockRejectedValueOnce(new Error('sidecar down'));
    listVoices.mockResolvedValue({ voices: [voice('en-a')] });
    const Probe = probeFor(await loadHook());

    await render(<Probe direction="vi_to_en" />);
    expect(latest).toEqual({ status: 'failed', voices: [] });

    await render(<></>);
    await render(<Probe direction="vi_to_en" />);

    expect(listVoices).toHaveBeenCalledTimes(2);
    expect(latest).toEqual({ status: 'ready', voices: [voice('en-a')] });
  });

  it('shares one request between panels mounting together', async () => {
    listVoices.mockResolvedValue({ voices: [voice('en-a')] });
    const Probe = probeFor(await loadHook());

    await render(
      <>
        <Probe direction="vi_to_en" />
        <Probe direction="vi_to_en" />
      </>,
    );

    expect(listVoices).toHaveBeenCalledTimes(1);
  });
});
