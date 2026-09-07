// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { HistoryList } from './history-list';
import { accentFilledControls } from '@/design/accent-count';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The list, and the three states that are easy to conflate: nothing fetched yet,
 * nothing to show, and a fetch that failed. Collapsing any two of them tells a
 * reader with a broken connection that they have no conversations.
 *
 * Rows are addressed by their link (`a[href^="/history/"]`) rather than by any
 * class or wrapper, so the markup can change shape — and it has, from a card per
 * row to a row on the page ground — without these assertions quietly becoming
 * assertions about something else.
 */

let container: HTMLDivElement;
let root: Root;

/**
 * What React complained about while rendering.
 *
 * A duplicate `key` is reported here and nowhere else: the render succeeds, the
 * DOM looks right, and the damage is to reconciliation on the NEXT update. A test
 * that only reads the DOM cannot see it, so the warnings are collected and the
 * one test that can produce them asserts on them.
 */
let reactErrors: string[];

/**
 * Fixed, so "today" and "yesterday" cannot drift into being real days.
 *
 * Midday, and the day fixtures below are placed at the SAME instant and exactly
 * 24h before it, so the pair straddles local midnight in every offset rather than
 * only in the one this was written on. `vitest.config.ts` pins `TZ` as well; both
 * are here because either alone has been enough to lose before.
 */
const NOW = new Date('2026-09-04T12:00:00.000Z');

const summary = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: '11111111-1111-4111-8111-111111111111',
  direction: 'vi_to_en',
  startedAt: '2026-09-03T10:00:00.000Z',
  endedAt: '2026-09-03T10:10:00.000Z',
  turnCount: 12,
  preview: 'xin chào',
  hasMinutes: false,
  ...overrides,
});

beforeEach(() => {
  reactErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    reactErrors.push(args.map(String).join(' '));
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof HistoryList>[0]> = {}) {
  const onLoadMore = vi.fn();
  const onRetry = vi.fn();
  const onClearSearch = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <HistoryList
          conversations={[]}
          loading={false}
          loadingMore={false}
          error={false}
          loadMoreError={false}
          searching={false}
          hasMore={false}
          onLoadMore={onLoadMore}
          onRetry={onRetry}
          onClearSearch={onClearSearch}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { container, onLoadMore, onRetry, onClearSearch };
}

function rows(): string[] {
  return [...container.querySelectorAll('a[href^="/history/"]')].map(
    (a) => a.getAttribute('href') ?? '',
  );
}

describe('HistoryList', () => {
  it('shows the empty state when the account has no conversations', () => {
    const { container } = render({ conversations: [] });
    expect(container.textContent).toContain('No conversations yet');
    expect(rows().length).toBe(0);
  });

  it('does not call an empty list "empty" while the first page is still loading', () => {
    const { container } = render({ loading: true });
    // Row-shaped skeletons rather than the word "Loading", so the first paint and
    // the loaded paint are the same shape. The sentence is still said, to screen
    // readers, where `aria-busy` alone would leave a blank silence.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Loading your conversations…',
    );
    expect(container.textContent).not.toContain('No conversations yet');
  });

  it('keeps the rows on screen while a search is in flight', () => {
    // The search term is part of the list key, so `loading` goes true on every
    // debounced keystroke. Guarding the ROWS rather than the markup: if the row
    // element changes shape, update the selector and keep this assertion.
    const { container } = render({
      conversations: [summary()],
      loading: true,
      searching: true,
    });
    expect(rows().length).toBe(1);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    // Every list, not the first: the rows are grouped by day, so a reader with
    // two days on screen would otherwise have one group announcing itself busy
    // and the other silent.
    const lists = [...container.querySelectorAll('ul')];
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((ul) => ul.getAttribute('aria-busy') === 'true')).toBe(true);
  });

  it('reports a failed load as a failure, not as an empty history', () => {
    const { container } = render({ error: true });
    expect(container.textContent).toContain('Could not load your history');
    expect(container.textContent).not.toContain('No conversations yet');
  });

  it('lists conversations in the order given, newest first', () => {
    render({
      conversations: [
        summary({ conversationId: 'newer', preview: 'second conversation' }),
        summary({ conversationId: 'older', preview: 'first conversation' }),
      ],
    });
    expect(rows()).toEqual(['/history/newer', '/history/older']);
  });

  it('shows the minutes marker only when minutes exist', () => {
    expect(
      render({ conversations: [summary({ hasMinutes: false })] }).container.textContent,
    ).not.toContain('Minutes');
    expect(
      render({ conversations: [summary({ hasMinutes: true })] }).container.textContent,
    ).toContain('Minutes');
  });

  it('draws the direction short and says it in full', () => {
    const { container } = render({ conversations: [summary({ turnCount: 12 })] });
    // What is drawn. The long form is 21 characters on every row, which at eight
    // rows is the loudest thing on a screen whose subject is the previews.
    expect(container.textContent).toContain('VI → EN');
    // What is announced. Hidden text, so it is in `textContent` either way —
    // what this holds is that the arrow is not the only rendering of the fact.
    const row = container.querySelector('a[href^="/history/"]');
    expect(row?.querySelector('.sr-only')?.textContent).toBe('Vietnamese → English');
    expect(container.textContent).toContain('12 lines');
  });

  it('rounds a short conversation up rather than reporting zero minutes', () => {
    const { container } = render({
      conversations: [
        summary({
          startedAt: '2026-09-03T10:00:00.000Z',
          endedAt: '2026-09-03T10:00:40.000Z',
        }),
      ],
    });
    expect(container.textContent).toContain('1 min');
  });

  it('heads each day once and leaves the row carrying only a time', () => {
    // Two conversations on one day and one on another: two headings, three rows,
    // and no full date repeated down the column.
    const { container } = render({
      conversations: [
        summary({ conversationId: 'a', startedAt: '2026-09-04T12:00:00.000Z' }),
        summary({ conversationId: 'b', startedAt: '2026-09-04T11:00:00.000Z' }),
        summary({ conversationId: 'c', startedAt: '2026-09-03T12:00:00.000Z' }),
      ],
    });

    const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Today', 'Yesterday']);
    expect(container.querySelectorAll('ul').length).toBe(2);
    expect(rows()).toEqual(['/history/a', '/history/b', '/history/c']);
  });

  it('survives a day that comes back after an older one, without losing a row', () => {
    // The list is ordered by the SERVER's stamp; the day heading is read off the
    // BROWSER's. The write schema accepts a `startedAt` up to a day either side of
    // the server clock, so a deferred save or a second device with a skewed clock
    // can put an older day in the middle. Rows are not reordered to hide it — the
    // API's ordering is the one thing that can be vouched for — so the heading
    // repeats, and every row still has to be on screen exactly once.
    const { container } = render({
      conversations: [
        summary({ conversationId: 'a', startedAt: '2026-09-04T12:00:00.000Z' }),
        summary({ conversationId: 'b', startedAt: '2026-09-03T12:00:00.000Z' }),
        summary({ conversationId: 'c', startedAt: '2026-09-04T11:00:00.000Z' }),
      ],
    });

    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Today',
      'Yesterday',
      'Today',
    ]);
    expect(rows()).toEqual(['/history/a', '/history/b', '/history/c']);
    // The heading may repeat; the KEY may not. Keyed on the day, the two "Today"
    // sections collide and React says reconciliation "may cause children to be
    // duplicated and/or omitted" — a warning, so nothing here fails on it unless
    // it is read. The group is keyed on its first conversation's id instead.
    expect(reactErrors.join(' ')).not.toContain('same key');
  });

  it('keeps the loaded conversations on screen when a further page fails', () => {
    const { container } = render({
      conversations: [summary({ conversationId: 'loaded', preview: 'already read' })],
      hasMore: true,
      loadMoreError: true,
    });

    expect(rows().length).toBe(1);
    expect(container.textContent).toContain('Could not load more conversations.');
    // The whole-screen failure belongs to a first page that never arrived.
    expect(container.textContent).not.toContain('Could not load your history');
    expect(container.textContent).toContain('Load more');
  });

  it('says "nothing matched" while searching, not "you have no history"', () => {
    const { container } = render({ conversations: [], searching: true });
    expect(container.textContent).toContain('No conversations match that.');
    expect(container.textContent).not.toContain('No conversations yet');
  });

  it('offers a way out of a search that matched nothing', () => {
    // Without it the recovery is "select the field and delete what you typed",
    // which is the state this screen is worst at making obvious.
    const { container, onClearSearch } = render({ conversations: [], searching: true });
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Clear search'),
    );
    act(() => button?.click());
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('offers another page only when one exists', () => {
    expect(
      render({ conversations: [summary()], hasMore: false }).container.textContent,
    ).not.toContain('Load more');

    const { container, onLoadMore } = render({ conversations: [summary()], hasMore: true });
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Load more'),
    );
    act(() => {
      button?.click();
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('spends no accent on this screen', () => {
    // The filled "Start a conversation" is gone: it invited the same destination
    // the sidebar's Translate entry does on every app screen. Held here as well
    // as in `accent-budget-app.spec.tsx` because this is the file whose states
    // could reintroduce one — an empty state with its own call to action.
    for (const props of [
      { conversations: [summary()] },
      { conversations: [] },
      { conversations: [], searching: true },
      { error: true },
    ]) {
      const { container } = render(props);
      // The shared counter, not a local reimplementation of it — two gates that
      // each decide for themselves what "accent-filled" means will eventually
      // disagree, and the one that is wrong is the one nobody is reading.
      expect(accentFilledControls(container).length, JSON.stringify(props)).toBe(0);
    }
  });
});
