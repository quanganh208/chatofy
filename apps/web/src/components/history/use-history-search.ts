'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** How long typing pauses before a search is sent. */
const DEBOUNCE_MS = 250;

/**
 * A navigation that never changes the pathname — a link opened in place of itself —
 * would otherwise hold the URL write off forever. Long past any real navigation.
 */
const NAVIGATION_GRACE_MS = 5_000;

/**
 * The history search term: typed locally, debounced, and reflected in the URL.
 *
 * Owned by the History LAYOUT, so moving between conversations keeps it: the layout
 * does not remount, and neither does this state.
 *
 * ## Who wins, the box or the URL
 *
 * While typing, the box: the URL follows the debounced term with `replace`. On a
 * NAVIGATION, the URL: every link this screen draws carries the current term, so a
 * navigation that arrives without it — the sidebar's History item — is a reset, and
 * the box empties as it would on a page that remounted.
 *
 * ## A row clicked mid-debounce
 *
 * The row's link is built from the TYPED term and `beginNavigation` flushes it, then
 * holds the URL write until the pathname changes. Otherwise the debounce would fire
 * after the click and `replace` the list's own URL while the row's navigation was
 * still in flight — and the router lets the newest navigation win, dropping the
 * click.
 */
export function useHistorySearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTerm = searchParams.get('q') ?? '';

  // Seeded from the URL so a shared link opens on its results, then owned locally:
  // a controlled input driven by the query string would re-render through the
  // router on every keystroke.
  const [term, setTerm] = useState(urlTerm);
  const [debounced, setDebounced] = useState(term);

  // A navigation landed: take the URL's term. Adjusted during render, so the list
  // never fetches one frame of the stale term against the new URL.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (urlTerm !== debounced) {
      setTerm(urlTerm);
      setDebounced(urlTerm);
    }
  }

  const navigating = useRef<number | null>(null);

  // Terms this hook has `replace`d into the URL and not yet seen land. A `q` that
  // changes WITHOUT a pathname change is either one of these arriving — ignored, or
  // it would rewind a reader who typed on before it landed — or a navigation to the
  // same page with another term (the sidebar's History from `/history?q=…`, Back),
  // which is adopted exactly like one that changed the pathname.
  const written = useRef(new Set<string>());

  useEffect(() => {
    if (written.current.delete(urlTerm)) return;
    if (urlTerm === debounced) return;
    // Following an external input — the URL — is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTerm(urlTerm);
    setDebounced(urlTerm);
    // `debounced` is read, not followed: a change to it is a write, not a navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTerm]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // Before the write below, so the write sees a navigation that has just landed as
  // finished. Effects run in declaration order.
  useEffect(() => {
    // A write that was still in flight across a page change will not land here.
    written.current.clear();
    if (navigating.current === null) return;
    clearTimeout(navigating.current);
    navigating.current = null;
  }, [pathname]);

  useEffect(
    () => () => {
      if (navigating.current !== null) clearTimeout(navigating.current);
    },
    [],
  );

  // The URL follows the DEBOUNCED term, so history is not filled with one entry per
  // character, and `replace` for the same reason. Skipped when the URL already says
  // it, and while a row's navigation is in flight (see above).
  useEffect(() => {
    if (navigating.current !== null) return;
    const next = new URLSearchParams(searchParams.toString());
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    const query = next.toString();
    if (query === searchParams.toString()) return;
    // `as Route`: `typedRoutes` cannot check a path built at runtime, and the
    // pathname half comes from the router itself.
    written.current.add(debounced);
    router.replace(`${pathname}${query ? `?${query}` : ''}` as Route);
    // `searchParams` is deliberately not a dependency: this effect WRITES it, and
    // depending on it would re-run the effect with its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, pathname, router]);

  const clear = useCallback(() => setTerm(''), []);

  /**
   * A row is being opened: apply what was typed and leave the URL to the link.
   *
   * No hold for a link to the page already open (re-clicking the open row): its
   * pathname never changes, so nothing would release the hold before the fallback,
   * and a search typed meanwhile would never reach the URL. There is no navigation
   * for the write to race, either — both name the same page.
   */
  const beginNavigation = useCallback(
    (targetPathname: string) => {
      setDebounced(term);
      if (targetPathname === pathname) return;
      if (navigating.current !== null) clearTimeout(navigating.current);
      navigating.current = window.setTimeout(() => {
        navigating.current = null;
      }, NAVIGATION_GRACE_MS);
    },
    [term, pathname],
  );

  /** `?q=…` for the list link after a delete and the back link. */
  const querySuffix = suffix(debounced);
  /** `?q=…` for a row's link: the TYPED term, which `beginNavigation` applies. */
  const rowQuerySuffix = suffix(term);

  return { term, setTerm, debounced, clear, querySuffix, rowQuerySuffix, beginNavigation };
}

function suffix(term: string): string {
  return term ? `?${new URLSearchParams({ q: term }).toString()}` : '';
}
