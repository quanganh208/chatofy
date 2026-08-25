// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslateSettings, type UseTranslateSettings } from './use-translate-settings';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  TRANSLATE_SETTINGS_STORAGE_KEY,
} from '@/lib/translate-settings';

/**
 * The write path, which is the part of this hook that is easy to get wrong and
 * impossible to see.
 *
 * A slider reports every pointer move. If each one reached `localStorage` the page
 * would do a synchronous write per frame on the thread that also schedules
 * translated audio — so the debounce is not a nicety, and "it still works" is not
 * evidence that it is still there. These assert the collapse itself.
 */

let container: HTMLDivElement;
let root: Root;
/** The latest committed hook value, so a test can call `set` and then read back. */
let latest: UseTranslateSettings;

function Probe() {
  const value = useTranslateSettings();
  // Captured in an effect, not during render. Assigning to a module variable while
  // rendering is a side effect React is allowed to discard or repeat, and the lint
  // rule that says so is right — `act` flushes effects, so every assertion below
  // still reads the value from the render it just triggered.
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function mount(): void {
  act(() => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  // Without this React warns on every `act` and does not flush work, so the
  // assertions below read a component that never committed.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.useFakeTimers();
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
  it('reads stored settings after mount rather than during render', () => {
    localStorage.setItem(
      TRANSLATE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_TRANSLATE_SETTINGS, volume: 0.25 }),
    );
    mount();
    // Reading in a useState initializer would render one value on the server and
    // another on the client; the effect is what keeps them the same.
    expect(latest.ready).toBe(true);
    expect(latest.settings.volume).toBe(0.25);
  });

  it('collapses a burst of changes into ONE write', () => {
    mount();
    const setItem = vi.spyOn(localStorage, 'setItem');

    // Stands in for a drag: many changes well inside the debounce window.
    act(() => {
      for (let step = 1; step <= 10; step += 1) latest.set({ volume: step / 10 });
    });
    expect(setItem).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(500));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(latest.settings.volume).toBe(1);
  });

  it('exposes each change immediately even though the write is deferred', () => {
    mount();
    act(() => latest.set({ voiceOutput: false }));
    // State and the reader are both current; only persistence waits.
    expect(latest.settings.voiceOutput).toBe(false);
    expect(latest.current().voiceOutput).toBe(false);
  });

  it('writes what the ref holds, not what the timer captured', () => {
    // The failure this guards: a child effect calls `set` before the parent's load
    // effect has installed the stored settings. A timer holding a captured value
    // would then overwrite the real ones 200ms later, and it would survive a reload.
    localStorage.setItem(
      TRANSLATE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_TRANSLATE_SETTINGS, voiceGender: 'male', volume: 0.3 }),
    );
    mount();

    act(() => latest.set({ volume: 0.9 }));
    act(() => void vi.advanceTimersByTime(500));

    const written = JSON.parse(
      localStorage.getItem(TRANSLATE_SETTINGS_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>;
    // The patched field changed; the stored field it never touched survived.
    expect(written.volume).toBe(0.9);
    expect(written.voiceGender).toBe('male');
  });

  it('flushes a pending write on unmount', () => {
    mount();
    act(() => latest.set({ volume: 0.5 }));

    const setItem = vi.spyOn(localStorage, 'setItem');
    act(() => root.unmount());
    expect(setItem).toHaveBeenCalledTimes(1);

    // Re-rooted so afterEach's unmount is harmless.
    root = createRoot(container);
  });

  it('flushes a pending write when the page goes away', () => {
    // React cleanup does not run on a tab close or reload, so the debounce window
    // would otherwise be a window in which a change is simply lost.
    mount();
    act(() => latest.set({ volume: 0.7 }));

    const setItem = vi.spyOn(localStorage, 'setItem');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(setItem).toHaveBeenCalledTimes(1);
    const written = JSON.parse(localStorage.getItem(TRANSLATE_SETTINGS_STORAGE_KEY) ?? '{}') as {
      volume?: number;
    };
    expect(written.volume).toBe(0.7);
  });

  it('does not write when nothing is pending', () => {
    mount();
    const setItem = vi.spyOn(localStorage, 'setItem');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(setItem).not.toHaveBeenCalled();
  });
});
