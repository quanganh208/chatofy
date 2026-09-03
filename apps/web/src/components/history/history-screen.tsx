'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Mic } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { HistoryList } from '@/components/history/history-list';
import { HistorySearchInput } from '@/components/history/history-search-input';
import { useConversationHistory } from '@/hooks/use-conversation-history';
import { useTranslate } from '@/i18n/provider';

/** How long typing pauses before a search is sent. */
const DEBOUNCE_MS = 250;

/**
 * The history list screen.
 *
 * ## The accent budget
 *
 * Exactly one accent-filled control, and it is the "Start a conversation" link
 * in the header — rendered in EVERY state, empty, populated, searching and
 * failed, so the count is one throughout. Rows are plain links; the search box
 * is an input; "load more" and "try again" are outline. That is the rule
 * `.claude/rules/development-rules.md` states and does not mechanically enforce
 * on app screens, so it is counted here by reading.
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
  const t = useTranslate();
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

  return (
    <div className="flex flex-col gap-6">
      {/* No line explaining what history is. `HistoryList` says it in its empty
          state, where it is the answer to "why is this screen blank"; saying it
          here as well printed the same sentence twice to the one reader who has
          never seen the screen before. */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        <Button asChild>
          <Link href="/translate">
            <Mic aria-hidden /> {t('web.translate.startConversation')}
          </Link>
        </Button>
      </div>

      <HistorySearchInput value={term} onChange={setTerm} />

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
      />
    </div>
  );
}
