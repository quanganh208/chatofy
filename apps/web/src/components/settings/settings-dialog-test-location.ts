'use client';

import { useSyncExternalStore } from 'react';

/**
 * For specs: `useSearchParams` that follows `window.history`, the way the App Router's
 * does in a browser.
 *
 * Next patches `pushState` and `replaceState` so `useSearchParams` re-renders on them;
 * a spec has no router, so a hook that writes the address through native history
 * would never see its own change. {@link followHistoryForTests} wraps the two methods
 * to announce each write, and Back is a `popstate` like it is in a browser.
 *
 * Mock `next/navigation` with `useSearchParams: useTestSearchParams`.
 */
const CHANGE = 'test:history-change';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener('popstate', onChange);
  };
}

export function useTestSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => '',
  );
  return new URLSearchParams(search);
}

/** Announce every `pushState`/`replaceState`; returns the undo for `afterEach`. */
export function followHistoryForTests(): () => void {
  const history = window.history;
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  const announce = () => window.dispatchEvent(new Event(CHANGE));
  // Own properties shadowing the prototype's methods, so the undo is deleting them.
  history.pushState = (...args: Parameters<History['pushState']>) => {
    pushState(...args);
    announce();
  };
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    replaceState(...args);
    announce();
  };
  return () => {
    Reflect.deleteProperty(history, 'pushState');
    Reflect.deleteProperty(history, 'replaceState');
  };
}
