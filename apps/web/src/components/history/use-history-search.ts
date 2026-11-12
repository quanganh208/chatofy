'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** How long typing pauses before a search is sent. */
const DEBOUNCE_MS = 250;

/**
 * The history search term: typed locally, debounced, and reflected in the URL.
 *
 * The term is reflected in the URL so a search is linkable and survives a reload —
 * and the input stays controlled locally so typing is never gated on a navigation.
 *
 * Owned by the History LAYOUT, so moving between conversations keeps it: the layout
 * does not remount, and neither does this state.
 */
export function useHistorySearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Seeded from the URL so a shared link opens on its results, then owned
  // locally: a controlled input driven by the query string would re-render
  // through the router on every keystroke.
  const [term, setTerm] = useState(() => searchParams.get('q') ?? '');
  const [debounced, setDebounced] = useState(term);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // The URL follows the DEBOUNCED term, so history is not filled with one entry
  // per character. `replace`, not `push`, for the same reason.
  //
  // Skipped when the URL already says it. The pathname is a dependency — a search
  // typed while a conversation is open belongs on that conversation's URL — so this
  // runs on every move between conversations, and a replace there would be a second
  // navigation per click that changes nothing.
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    const query = next.toString();
    if (query === searchParams.toString()) return;
    // `as Route`: `typedRoutes` cannot check a path built at runtime, and the
    // pathname half comes from the router itself — so the cast asserts only what
    // `usePathname` already guarantees.
    router.replace(`${pathname}${query ? `?${query}` : ''}` as Route);
    // `searchParams` is deliberately not a dependency: this effect WRITES it,
    // and depending on it would re-run the effect with its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, pathname, router]);

  const clear = useCallback(() => setTerm(''), []);

  /** `?q=…` for links that should keep the search, or nothing. */
  const querySuffix = debounced ? `?${new URLSearchParams({ q: debounced }).toString()}` : '';

  return { term, setTerm, debounced, clear, querySuffix };
}
