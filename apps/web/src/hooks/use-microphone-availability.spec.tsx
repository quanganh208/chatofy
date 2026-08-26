// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMicrophoneAvailability,
  type MicrophoneAvailability,
} from './use-microphone-availability';

/**
 * The two answers a readiness row is allowed to give about hardware, and the
 * subscription that keeps them true.
 *
 * Plugging a microphone in is the fix the `absent` row asks for, so a hook that never
 * re-read would leave the card contradicting the machine for as long as the tab stays
 * open — and nothing on screen would look wrong.
 */

let container: HTMLDivElement;
let root: Root;
let latest: MicrophoneAvailability;
const listeners = new Set<() => void>();

function Probe() {
  const value = useMicrophoneAvailability();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function stubDevices(enumerateDevices: () => Promise<MediaDeviceInfo[]>): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    },
  });
}

const inputs = (...kinds: MediaDeviceKind[]) => kinds.map((kind) => ({ kind }) as MediaDeviceInfo);

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Probe />);
    // Lets the `enumerateDevices` promise settle inside the same `act`, so the state
    // it writes is committed before an assertion reads it.
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listeners.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMicrophoneAvailability', () => {
  it('reports a microphone that is there', async () => {
    stubDevices(() => Promise.resolve(inputs('audioinput', 'audiooutput')));
    await mount();
    expect(latest).toBe('present');
  });

  it('reads an empty input list as absent rather than as unknown', async () => {
    // Browsers publish a blank placeholder per kind before permission is granted, so
    // no entry means no device — not "not allowed to look".
    stubDevices(() => Promise.resolve(inputs('audiooutput')));
    await mount();
    expect(latest).toBe('absent');
  });

  it('re-reads when a device is plugged in', async () => {
    let present = false;
    stubDevices(() => Promise.resolve(present ? inputs('audioinput') : []));
    await mount();
    expect(latest).toBe('absent');

    present = true;
    await act(async () => {
      listeners.forEach((fn) => fn());
      await Promise.resolve();
    });
    expect(latest).toBe('present');
  });

  it('stays unknown when the browser refuses to enumerate', async () => {
    stubDevices(() => Promise.reject(new Error('no')));
    await mount();
    expect(latest).toBe('unknown');
  });

  it('stays unknown where there is no mediaDevices at all', async () => {
    vi.stubGlobal('navigator', {});
    await mount();
    expect(latest).toBe('unknown');
  });
});
