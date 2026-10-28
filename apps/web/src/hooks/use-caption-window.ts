'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cloneDocumentStyles } from '@/lib/clone-document-styles';

/**
 * The floating caption window: an always-on-top Document Picture-in-Picture
 * window where the browser has one (Chromium 116+), and a small popup where it
 * does not (Firefox, Safari). One control opens whichever exists — the reader
 * asked for captions that float, not for an API.
 *
 * ## The window renders; the page runs
 *
 * Nothing about the conversation moves. The microphone, the socket and the voice
 * stay on the page, and the window is a portal target: `CaptionWindowPortal`
 * renders the stage into the element this hook hands back. React registers its
 * event listeners on a portal's container as well as on its root, so the close
 * button and the scroll region inside a window in ANOTHER document still work,
 * and every context (locale, theme) flows through unchanged. Closing the window
 * therefore ends nothing but the window.
 *
 * ## Two lifetimes to follow
 *
 * The reader closes the window — its `pagehide` resets this hook. The page goes
 * away — a Picture-in-Picture window closes with its opener on its own, a popup
 * does not, so both are closed here on unmount and on the page's own `pagehide`
 * rather than left floating over a conversation that no longer exists.
 *
 * ## Inside the click, or not at all
 *
 * Both routes need user activation, so `open` must be called synchronously from
 * the press. A popup the browser blocks comes back `null`, and that is reported
 * as `blocked` for the page to explain — the one refusal here the reader can fix.
 * A refused Picture-in-Picture request is `failed`, which names no fix, because
 * none of its causes is a setting the reader owns.
 */
export type CaptionWindowKind = 'pip' | 'popup';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const WIDTH = 480;
const HEIGHT = 320;

const subscribeNever = () => () => {};
const clientKind = (): CaptionWindowKind => (window.documentPictureInPicture ? 'pip' : 'popup');
const serverKind = (): CaptionWindowKind => 'popup';

export interface UseCaptionWindow {
  /** Which window a press opens. `popup` until hydrated, then the real answer. */
  kind: CaptionWindowKind;
  /** Where to portal the stage while the window is open; null when it is not. */
  container: HTMLElement | null;
  /**
   * Why the last open produced no window: the pop-up blocker refused the popup
   * (something the reader can fix in the browser), or the Picture-in-Picture
   * request failed (nothing to fix, try again). Null when it opened.
   */
  failure: 'blocked' | 'failed' | null;
  open: () => void;
  close: () => void;
}

export function useCaptionWindow(title: string): UseCaptionWindow {
  const kind = useSyncExternalStore(subscribeNever, clientKind, serverKind);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [failure, setFailure] = useState<UseCaptionWindow['failure']>(null);
  const current = useRef<{ win: Window; dispose: () => void } | null>(null);
  // A Picture-in-Picture request is a promise, and two things can happen before
  // it settles: a second press, and the page unmounting on a client-side route
  // change — which fires no `pagehide`. Both are answered when it resolves.
  const pending = useRef(false);
  const mounted = useRef(true);

  const release = useCallback(() => {
    current.current?.dispose();
    current.current = null;
    setContainer(null);
  }, []);

  const close = useCallback(() => {
    const win = current.current?.win;
    release();
    win?.close();
  }, [release]);

  const adopt = useCallback(
    (win: Window) => {
      const doc = win.document;
      // A fresh window has nothing worth keeping, and a Picture-in-Picture one
      // has a default head of its own. The title after, because it lives in the
      // head being emptied.
      doc.head.replaceChildren();
      doc.body.replaceChildren();
      doc.title = title;
      const dispose = cloneDocumentStyles(document, doc);
      doc.body.style.margin = '0';
      const mount = doc.createElement('div');
      mount.style.cssText = 'display:flex;flex-direction:column;height:100vh';
      doc.body.append(mount);

      const onGone = () => {
        if (current.current?.win === win) release();
      };
      win.addEventListener('pagehide', onGone, { once: true });
      current.current = {
        win,
        dispose: () => {
          dispose();
          win.removeEventListener('pagehide', onGone);
        },
      };
      setContainer(mount);
    },
    [release, title],
  );

  const open = useCallback(() => {
    if (current.current) {
      current.current.win.focus();
      return;
    }
    if (pending.current) return;
    setFailure(null);
    if (window.documentPictureInPicture) {
      pending.current = true;
      window.documentPictureInPicture
        .requestWindow({ width: WIDTH, height: HEIGHT })
        .then((win) => {
          pending.current = false;
          // The page left while the browser was opening it: nothing would ever
          // close this window, so it is closed before it is shown anything.
          if (!mounted.current) {
            win.close();
            return;
          }
          adopt(win);
        })
        .catch(() => {
          pending.current = false;
          if (mounted.current) setFailure('failed');
        });
      return;
    }
    // Unnamed: a name is shared by every tab in the browsing-context group, and a
    // second /translate tab would empty the first one's window to adopt it.
    const win = window.open('', '', `popup,width=${WIDTH},height=${HEIGHT}`);
    if (!win) {
      setFailure('blocked');
      return;
    }
    adopt(win);
  }, [adopt]);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', close);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', close);
      close();
    };
  }, [close]);

  return { kind, container, failure, open, close };
}
