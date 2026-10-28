'use client';

import { useSyncExternalStore } from 'react';
import type { ColorScheme } from '@chatofy/ui';

/**
 * The theme actually on screen: the reader's explicit choice when there is one
 * (the class `app/layout.tsx` puts on `<html>`), the system's otherwise.
 *
 * For measuring, not for styling — every token already follows `color-scheme` by
 * itself. What needs the answer in JavaScript is a contrast ratio, which has to
 * know which half of each `light-dark()` pair the reader is looking at.
 */
const QUERY = '(prefers-color-scheme: dark)';

function read(): ColorScheme {
  const root = document.documentElement.classList;
  if (root.contains('dark')) return 'dark';
  if (root.contains('light')) return 'light';
  return window.matchMedia?.(QUERY).matches ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onChange);
  };
}

export function useResolvedColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, read, () => 'light');
}
