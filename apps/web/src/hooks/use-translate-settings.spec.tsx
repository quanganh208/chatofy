// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslateSettings, type UseTranslateSettings } from './use-translate-settings';
import { MIC_PROCESSING_STORAGE_KEY } from '@/lib/mic-processing-store';
import {
  fakePreferencesServer,
  signInPreferences,
  type FakePreferencesServer,
} from '@/lib/preferences/preferences.fixture';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';

/**
 * The write path, which is the part of this hook that is easy to get wrong and
 * impossible to see.
 *
 * A slider reports every pointer move. If each one became a request the account
 * would take a PATCH per frame — so the debounce is not a nicety, and "it still
 * works" is not evidence that it is still there. These assert the collapse itself,
 * against the real sync store and an in-memory server.
 */

let container: HTMLDivElement;
let root: Root;
/** The latest committed hook value, so a test can call `set` and then read back. */
let latest: UseTranslateSettings;
let server: FakePreferencesServer;

function Probe() {
  const value = useTranslateSettings();
  // Captured in an effect, not during render. Assigning to a module variable while
  // rendering is a side effect React is allowed to discard or repeat.
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

async function mount(): Promise<void> {
  act(() => {
    root.render(<Probe />);
  });
  // The first server read, which lands after the cache.
  await act(() => vi.advanceTimersByTimeAsync(0));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  server = fakePreferencesServer({ reading: { textSize: 3, speakerLabels: false } });
  signInPreferences(server, { debounceMs: 200 });
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

describe('useTranslateSettings', () => {
  it("reports the account's settings once ready", async () => {
    await mount();
    expect(latest.ready).toBe(true);
    expect(latest.settings.textSize).toBe(3);
    expect(latest.settings.speakerLabels).toBe(false);
  });

  it('collapses a burst of changes into ONE save', async () => {
    await mount();
    // Stands in for a drag: many changes well inside the debounce window.
    act(() => {
      for (let step = 1; step <= 10; step += 1) latest.set({ textSize: step });
    });
    expect(server.saves).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(server.saves).toEqual([{ reading: { textSize: 10 } }]);
    expect(latest.settings.textSize).toBe(10);
  });

  it('exposes each change immediately even though the save is deferred', async () => {
    await mount();
    act(() => latest.set({ freeScroll: true }));
    // State and the reader are both current; only the save waits.
    expect(latest.settings.freeScroll).toBe(true);
    expect(latest.current().freeScroll).toBe(true);
  });

  it('saves only what changed, so a field it never touched survives', async () => {
    // Another device's choices must not be overwritten by a copy of this one's.
    await mount();
    act(() => latest.set({ textSize: 9 }));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(server.stored().reading).toMatchObject({ textSize: 9, speakerLabels: false });
  });

  it('keeps the microphone chain on this device', async () => {
    await mount();
    const micProcessing = { ...DEFAULT_TRANSLATE_SETTINGS.micProcessing, echoCancellation: false };
    act(() => latest.set({ micProcessing }));
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(latest.settings.micProcessing.echoCancellation).toBe(false);
    expect(JSON.parse(localStorage.getItem(MIC_PROCESSING_STORAGE_KEY) ?? '{}')).toEqual(
      micProcessing,
    );
    expect(server.saves).toEqual([]);
  });

  it('keeps two owners in step', async () => {
    // A translate page and the Settings dialog opened over it each own one; both
    // read the same store, so neither can hold or write back a stale copy.
    const values: UseTranslateSettings[] = [];
    function Owner({ index }: { index: number }) {
      const value = useTranslateSettings();
      React.useEffect(() => {
        values[index] = value;
      });
      return null;
    }
    act(() => {
      root.render(
        <>
          <Owner index={0} />
          <Owner index={1} />
        </>,
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => values[1]!.set({ textSize: 4 }));
    expect(values[0]!.settings.textSize).toBe(4);
    expect(values[0]!.current().textSize).toBe(4);

    act(() => values[0]!.set({ freeScroll: true }));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(server.stored().reading).toMatchObject({ textSize: 4, freeScroll: true });
  });

  it('hands back the same settings object while nothing changes', async () => {
    // Consumers put `settings` in effect deps; a fresh object per render would
    // re-run them every render.
    await mount();
    const first = latest.settings;
    act(() => root.render(<Probe />));
    expect(latest.settings).toBe(first);
  });
});
