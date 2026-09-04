'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { HistoryList } from '@/components/history/history-list';
import { HistorySearchInput } from '@/components/history/history-search-input';
import { useConversationHistory } from '@/hooks/use-conversation-history';

/** How long typing pauses before a search is sent. */
const DEBOUNCE_MS = 250;

/**
 * The history list screen.
 *
 * ## The accent budget
 *
 * Zero accent-filled controls, in every state. There used to be one: a filled
 * "Start a conversation" alone in a right-aligned row above the search field.
 * It pointed at `/translate`, which is also the sidebar's Translate entry —
 * present on every app screen, 200px away — so the same destination was being
 * offered twice on the one screen whose job is FINDING rather than starting.
 * The rule is a ceiling, not a quota, so spending none of it here is correct
 * and `accent-budget-app.spec.tsx` holds the screen at zero.
 *
 * The search term is reflected in the URL, so a search is linkable and survives
 * a reload — and the input stays controlled locally so typing is never gated on
 * a navigation.
 */
export function HistoryScreen() {
  return (
    // `useSearchParams` needs one, for the reason /login and /verify-email give.
    <Suspense fallback={null}>
      <HistoryScreenBody />
    </Suspense>
  );
}

function HistoryScreenBody() {
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
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    const query = next.toString();
    // `as Route`: `typedRoutes` cannot check a path built at runtime, and the
    // pathname half comes from the router itself — so the cast asserts only what
    // `usePathname` already guarantees.
    router.replace(`${pathname}${query ? `?${query}` : ''}` as Route);
    // `searchParams` is deliberately not a dependency: this effect WRITES it,
    // and depending on it would re-run the effect with its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, pathname, router]);

  const history = useConversationHistory(debounced);
  const clearSearch = useCallback(() => setTerm(''), []);

  // Nothing to search, so the field says so by not accepting a term. This is
  // also why the state cannot be reached BY typing: an empty box is part of the
  // condition, so a search that matched nothing keeps the field live and gets
  // the inline "no matches" row instead.
  const nothingToSearch =
    term.trim() === '' && !history.loading && !history.error && history.conversations.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* No line explaining what history is. `HistoryList` says it in its empty
          state, where it is the answer to "why is this screen blank"; saying it
          here as well printed the same sentence twice to the one reader who has
          never seen the screen before. */}
      <HistorySearchInput value={term} onChange={setTerm} disabled={nothingToSearch} />

      <HistoryList
        conversations={history.conversations}
        loading={history.loading}
        loadingMore={history.loadingMore}
        error={history.error}
        loadMoreError={history.loadMoreError}
        searching={history.searching}
        hasMore={history.hasMore}
        onLoadMore={history.loadMore}
        onRetry={history.reload}
        onClearSearch={clearSearch}
      />
    </div>
  );
}
