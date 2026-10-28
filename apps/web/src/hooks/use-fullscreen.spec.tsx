// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen, type UseFullscreen } from './use-fullscreen';

let container: HTMLDivElement;
let root: Root;
let latest: UseFullscreen<HTMLDivElement>;
let element: HTMLDivElement | null = null;

function Probe() {
  const value = useFullscreen<HTMLDivElement>();
  // In an effect, not during render — see `use-translate-settings.spec.tsx`.
  useEffect(() => {
    latest = value;
  });
  return (
    <div
      ref={(node) => {
        element = node;
        value.attach(node);
      }}
    />
  );
}

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  vi.restoreAllMocks();
});

describe('useFullscreen, where the browser grants it', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  });

  it('asks for the element itself and follows the browser, not the request', () => {
    const request = vi.fn(() => Promise.resolve());
    element!.requestFullscreen = request;
    act(() => latest.enter());
    expect(request).toHaveBeenCalledOnce();
    // Requested is not granted: nothing changes until the browser says so.
    expect(latest.active).toBe(false);

    setFullscreenElement(element);
    expect(latest.active).toBe(true);
    expect(latest.emulated).toBe(false);

    // Esc, handled by the browser: the hook hears it as a change event.
    setFullscreenElement(null);
    expect(latest.active).toBe(false);
  });

  it('falls through to the layer when the browser refuses after all', async () => {
    element!.requestFullscreen = () => Promise.reject(new Error('denied'));
    await act(async () => {
      latest.enter();
      await Promise.resolve();
    });
    expect(latest.active).toBe(true);
    expect(latest.emulated).toBe(true);
  });
});

describe('useFullscreen, where it does not exist', () => {
  it('covers the viewport itself, and Esc leaves', () => {
    act(() => latest.enter());
    expect(latest.emulated).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(latest.active).toBe(false);
  });

  it('leaves by the exit control too', () => {
    act(() => latest.enter());
    act(() => latest.exit());
    expect(latest.active).toBe(false);
  });

  it('gives focus back to what asked for fullscreen', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    act(() => latest.enter());
    // The stage takes focus while it is up; leaving must not strand it on body.
    act(() => element!.setAttribute('tabindex', '-1'));
    act(() => element!.focus());
    act(() => latest.exit());
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
