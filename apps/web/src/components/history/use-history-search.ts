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

  // The terms this hook has `replace`d into the URL and not yet seen land, OLDEST
  // FIRST, and the URL term as last seen. See the sync effect below.
  const pending = useRef<string[]>([]);
  const seenUrl = useRef(urlTerm);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // Before the write below, so the write sees a navigation that has just landed as
  // finished. Effects run in declaration order.
  useEffect(() => {
    // A write still in flight across a page change will not land here, and the
    // render above has already adopted the new page's term.
    pending.current = [];
    seenUrl.current = urlTerm;
    if (navigating.current === null) return;
    clearTimeout(navigating.current);
    navigating.current = null;
    // Keyed on the page alone: `urlTerm` is snapshotted here, and following it would
    // empty the queue on every one of our own writes landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(
    () => () => {
      if (navigating.current !== null) clearTimeout(navigating.current);
    },
    [],
  );

  /*
    The box and the URL, kept in step in ONE effect — split, a URL change and the
    write could run in the same pass with each other's stale values.

    1. A URL term that changed is either one of OUR writes landing or a navigation.
       Ours: drop it and every older write, which the router discarded when it took
       a newer navigation — left queued, a superseded term would later swallow a
       real `?q=` that happened to match it. Not ours: a navigation (the sidebar's
       History from `/history?q=…`, Back), adopted into the box and the list.
    2. Then write the debounced term unless the URL already shows it or the newest
       queued write will. Re-run on every landing, this is what heals one that
       arrives after the box moved on: the URL disagrees, so the box's term is
       written again.

    `replace`, not `push`, and debounced, so history is not one entry per
    character. Held while a row's navigation is in flight (see above).
  */
  useEffect(() => {
    if (urlTerm !== seenUrl.current) {
      seenUrl.current = urlTerm;
      const landed = pending.current.indexOf(urlTerm);
      if (landed === -1) {
        pending.current = [];
        if (urlTerm !== debounced) {
          // Following an external input — the URL — is what this branch is for.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTerm(urlTerm);
          setDebounced(urlTerm);
        }
        return;
      }
      pending.current = pending.current.slice(landed + 1);
    }

    if (navigating.current !== null) return;
    // Never a write the URL already shows: one could only land as "no change", and
    // its queue entry would then never be drained. If an older write is still in
    // flight and lands later, step 1 sees the URL change and step 2 corrects it.
    if (debounced === urlTerm) return;
    if (debounced === pending.current.at(-1)) return;
    const next = new URLSearchParams(searchParams.toString());
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    const query = next.toString();
    pending.current = [...pending.current, debounced];
    // `as Route`: `typedRoutes` cannot check a path built at runtime, and the
    // pathname half comes from the router itself.
    router.replace(`${pathname}${query ? `?${query}` : ''}` as Route);
    // `searchParams` is read for the OTHER params only; `urlTerm` is its `q`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, urlTerm, pathname, router]);

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
