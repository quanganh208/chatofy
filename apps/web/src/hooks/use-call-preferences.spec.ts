// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakePreferencesServer,
  signInPreferences,
  type FakePreferencesServer,
} from '@/lib/preferences/preferences.fixture';
import { useCallPreferences } from './use-call-preferences';

/**
 * What a reader chose for hearing and reading a call — an account preference. Read
 * from a document other clients write too, so every field is checked.
 */
let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useCallPreferences>;

function Probe() {
  const value = useCallPreferences();
  // In an effect, not during render — see `use-translate-settings.spec.tsx`.
  useEffect(() => {
    current = value;
  });
  return null;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = () => act(() => root.render(createElement(Probe)));

describe('useCallPreferences', () => {
  it('starts with captions on at the middle size and original voices at full volume', () => {
    mount();
    expect(current.prefs).toEqual({ captions: true, captionSize: 'md', originalVolume: 1 });
  });

  /** Sign in with `stored` on the server and let the first read land. */
  async function signIn(stored: Record<string, unknown>): Promise<FakePreferencesServer> {
    const server = fakePreferencesServer();
    server.setStored({ ...server.stored(), ...stored });
    signInPreferences(server);
    mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    return server;
  }

  it("adopts the account's choice", async () => {
    vi.useFakeTimers();
    await signIn({ call: { captions: false, captionSize: 'xl', originalVolume: 0.3 } });
    expect(current.prefs).toEqual({ captions: false, captionSize: 'xl', originalVolume: 0.3 });
    vi.useRealTimers();
  });

  it('replaces a field that is invalid, and only that one', async () => {
    vi.useFakeTimers();
    await signIn({ call: { captions: 'yes', captionSize: 'xl', originalVolume: 7 } });
    expect(current.prefs).toEqual({ captions: true, captionSize: 'xl', originalVolume: 1 });
    vi.useRealTimers();
  });

  it('merges an update and saves only what changed', async () => {
    vi.useFakeTimers();
    const server = await signIn({});
    act(() => current.update({ captionSize: 'lg' }));
    act(() => current.update({ originalVolume: 0.25 }));
    expect(current.prefs).toEqual({ captions: true, captionSize: 'lg', originalVolume: 0.25 });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(server.saves).toEqual([{ call: { captionSize: 'lg', originalVolume: 0.25 } }]);
    expect(server.stored().call).toEqual(current.prefs);
    vi.useRealTimers();
  });

  it('keeps the volume between 0 and 1', () => {
    mount();
    act(() => current.update({ originalVolume: 4 }));
    expect(current.prefs.originalVolume).toBe(1);
    act(() => current.update({ originalVolume: -1 }));
    expect(current.prefs.originalVolume).toBe(0);
  });
});
