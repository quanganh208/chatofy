// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCallPreferences } from './use-call-preferences';

/**
 * What a reader chose for hearing and reading a call, remembered in this browser.
 * Read from storage the page does not control, so every field is checked.
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

  it('adopts a stored choice', () => {
    localStorage.setItem(
      'chatofy.call-preferences',
      JSON.stringify({ captions: false, captionSize: 'xl', originalVolume: 0.3 }),
    );
    mount();
    expect(current.prefs).toEqual({ captions: false, captionSize: 'xl', originalVolume: 0.3 });
  });

  it('replaces a field that is invalid', () => {
    localStorage.setItem(
      'chatofy.call-preferences',
      JSON.stringify({ captions: 'yes', captionSize: 'huge', originalVolume: 7 }),
    );
    mount();
    expect(current.prefs).toEqual({ captions: true, captionSize: 'md', originalVolume: 1 });
  });

  it('ignores storage that is not JSON', () => {
    localStorage.setItem('chatofy.call-preferences', '{nope');
    mount();
    expect(current.prefs.captionSize).toBe('md');
  });

  it('merges an update and stores it', () => {
    mount();
    act(() => current.update({ captionSize: 'lg' }));
    act(() => current.update({ originalVolume: 0.25 }));
    expect(current.prefs).toEqual({ captions: true, captionSize: 'lg', originalVolume: 0.25 });
    expect(JSON.parse(localStorage.getItem('chatofy.call-preferences') ?? '{}')).toEqual(
      current.prefs,
    );
  });

  it('keeps the volume between 0 and 1', () => {
    mount();
    act(() => current.update({ originalVolume: 4 }));
    expect(current.prefs.originalVolume).toBe(1);
    act(() => current.update({ originalVolume: -1 }));
    expect(current.prefs.originalVolume).toBe(0);
  });
});
