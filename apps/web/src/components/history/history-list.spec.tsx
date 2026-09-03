// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { HistoryList } from './history-list';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The list, and the three states that are easy to conflate: nothing fetched yet,
 * nothing to show, and a fetch that failed. Collapsing any two of them tells a
 * reader with a broken connection that they have no conversations.
 */

let container: HTMLDivElement;
let root: Root;

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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof HistoryList>[0]> = {}) {
  const onLoadMore = vi.fn();
  const onRetry = vi.fn();
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
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { container, onLoadMore, onRetry };
}

describe('HistoryList', () => {
  it('shows the empty state when the account has no conversations', () => {
    const { container } = render({ conversations: [] });
    expect(container.textContent).toContain('No conversations yet');
    expect(container.querySelectorAll('a[href^="/history/"]').length).toBe(0);
  });

  it('does not call an empty list "empty" while the first page is still loading', () => {
    const { container } = render({ loading: true });
    expect(container.textContent).toContain('Loading your conversations…');
    expect(container.textContent).not.toContain('No conversations yet');
  });

  it('reports a failed load as a failure, not as an empty history', () => {
    const { container } = render({ error: true });
    expect(container.textContent).toContain('Could not load your history');
    expect(container.textContent).not.toContain('No conversations yet');
  });

  it('lists conversations in the order given, newest first', () => {
    const { container } = render({
      conversations: [
        summary({ conversationId: 'newer', preview: 'second conversation' }),
        summary({ conversationId: 'older', preview: 'first conversation' }),
      ],
    });
    const links = [...container.querySelectorAll('a[href^="/history/"]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(['/history/newer', '/history/older']);
  });

  it('shows the minutes marker only when minutes exist', () => {
    expect(
      render({ conversations: [summary({ hasMinutes: false })] }).container.textContent,
    ).not.toContain('Minutes');
    expect(
      render({ conversations: [summary({ hasMinutes: true })] }).container.textContent,
    ).toContain('Minutes');
  });

  it('names the direction and the line count on the card', () => {
    const { container } = render({ conversations: [summary({ turnCount: 12 })] });
    expect(container.textContent).toContain('Vietnamese → English');
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

  it('keeps the loaded conversations on screen when a further page fails', () => {
    const { container } = render({
      conversations: [summary({ conversationId: 'loaded', preview: 'already read' })],
      hasMore: true,
      loadMoreError: true,
    });

    expect(container.querySelectorAll('a[href^="/history/"]').length).toBe(1);
    expect(container.textContent).toContain('Could not load more conversations.');
    // The whole-screen failure card belongs to a first page that never arrived.
    expect(container.textContent).not.toContain('Could not load your history');
    expect(container.textContent).toContain('Load more');
  });

  it('says "nothing matched" while searching, not "you have no history"', () => {
    const { container } = render({ conversations: [], searching: true });
    expect(container.textContent).toContain('No conversations match that.');
    expect(container.textContent).not.toContain('No conversations yet');
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
});
