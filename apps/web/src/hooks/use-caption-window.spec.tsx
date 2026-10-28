// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCaptionWindow, type UseCaptionWindow } from './use-caption-window';

/** A stand-in for the second window: a real document, an event target, close and focus. */
function fakeWindow() {
  const target = new EventTarget();
  const close = vi.fn(() => target.dispatchEvent(new Event('pagehide')));
  const focus = vi.fn();
  const win = Object.assign(target, {
    document: document.implementation.createHTMLDocument(''),
    close,
    focus,
  }) as unknown as Window;
  return { win, close, focus };
}

let container: HTMLDivElement;
let root: Root;
let latest: UseCaptionWindow;

function Probe() {
  const value = useCaptionWindow('Captions');
  useEffect(() => {
    latest = value;
  });
  return null;
}

const mount = () => act(() => root.render(<Probe />));

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.documentPictureInPicture;
  vi.restoreAllMocks();
});

describe('useCaptionWindow, without Document Picture-in-Picture', () => {
  it('opens a named popup and hands back a mount point in it', () => {
    const { win } = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(win);
    mount();
    expect(latest.kind).toBe('popup');

    act(() => latest.open());
    expect(open).toHaveBeenCalledWith('', '', expect.stringContaining('popup'));
    expect(latest.container?.ownerDocument).toBe(win.document);
    expect(win.document.title).toBe('Captions');
  });

  it('says so when the pop-up blocker refuses', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    act(() => latest.open());
    expect(latest.failure).toBe('blocked');
    expect(latest.container).toBeNull();
  });

  it('forgets the window when the reader closes it', () => {
    const { win } = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    mount();
    act(() => latest.open());
    act(() => {
      win.dispatchEvent(new Event('pagehide'));
    });
    expect(latest.container).toBeNull();
  });

  it('focuses the open window rather than opening a second', () => {
    const { win, focus } = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(win);
    mount();
    act(() => latest.open());
    act(() => latest.open());
    expect(open).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('closes a popup the page leaves behind', () => {
    // A Picture-in-Picture window closes with its opener; a popup does not.
    const { win, close } = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    mount();
    act(() => latest.open());
    act(() => root.unmount());
    expect(close).toHaveBeenCalled();
    root = createRoot(container);
  });
});

describe('useCaptionWindow, with Document Picture-in-Picture', () => {
  it('asks for a Picture-in-Picture window and never a popup', async () => {
    const { win } = fakeWindow();
    const requestWindow = vi.fn(() => Promise.resolve(win));
    window.documentPictureInPicture = { requestWindow };
    const open = vi.spyOn(window, 'open');
    mount();
    expect(latest.kind).toBe('pip');

    await act(async () => {
      latest.open();
      await Promise.resolve();
    });
    expect(requestWindow).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(latest.container?.ownerDocument).toBe(win.document);
  });

  it('reports a refused request instead of doing nothing', async () => {
    window.documentPictureInPicture = { requestWindow: () => Promise.reject(new Error('no')) };
    mount();
    await act(async () => {
      latest.open();
      await Promise.resolve();
    });
    // Not the pop-up blocker's message: no browser setting fixes this.
    expect(latest.failure).toBe('failed');
  });

  it('asks once, however often it is pressed while the browser decides', async () => {
    let resolve!: (win: Window) => void;
    const requestWindow = vi.fn(() => new Promise<Window>((r) => (resolve = r)));
    window.documentPictureInPicture = { requestWindow };
    mount();
    act(() => latest.open());
    act(() => latest.open());
    expect(requestWindow).toHaveBeenCalledOnce();
    const { win } = fakeWindow();
    await act(async () => {
      resolve(win);
      await Promise.resolve();
    });
    expect(latest.container?.ownerDocument).toBe(win.document);
  });

  it('closes a window that arrives after the page has gone', async () => {
    // A client-side route change unmounts the page without a `pagehide`.
    let resolve!: (win: Window) => void;
    window.documentPictureInPicture = {
      requestWindow: () => new Promise<Window>((r) => (resolve = r)),
    };
    mount();
    act(() => latest.open());
    act(() => root.unmount());
    const { win, close } = fakeWindow();
    await act(async () => {
      resolve(win);
      await Promise.resolve();
    });
    expect(close).toHaveBeenCalled();
    root = createRoot(container);
  });
});
