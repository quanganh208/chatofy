// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * History as one screen: the list the layout owns, and what fills the pane beside it.
 *
 * Two halves. The search field, and the one state where it is not offered — an
 * account with nothing stored cannot be searched, and the trap is the state next
 * door, a search that MATCHED nothing, where disabling the field would lock a reader
 * inside their own query. Then the master–detail contract: the newest conversation
 * opens on a wide `/history` without a navigation, the open row is marked, and moving
 * between conversations never refetches the list.
 *
 * Width is a box model fact happy-dom does not have, so `useContainerWide` is mocked;
 * the CSS that draws each layout is the container classes, which this cannot see.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listConversations = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getConversation = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
const deleteConversation = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());
vi.mock('@/clients/api-client', () => ({
  listConversations: () => listConversations(),
  getConversation: (id: string) => getConversation(id),
  deleteConversation: (id: string) => deleteConversation(id),
}));

vi.mock('@/hooks/use-minutes', () => ({
  useMinutes: () => ({ minutes: null, loading: false, error: false, generate: vi.fn() }),
}));

const nav = vi.hoisted(() => {
  const params: { conversationId?: string } = {};
  return { params, push: vi.fn(), replace: vi.fn() };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () =>
    nav.params.conversationId ? `/history/${nav.params.conversationId}` : '/history',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => nav.params,
}));

const layout = vi.hoisted(() => ({ wide: false }));
vi.mock('./use-container-wide', () => ({ useContainerWide: () => layout.wide }));

const { HistoryMasterDetail } = await import('./history-master-detail');
const { HistoryNewestDetail } = await import('./history-newest-detail');
const { ConversationDetail } = await import('./conversation-detail');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  container = document.createElement('div');
  document.body.append(container);
  nav.params = {};
  layout.wide = false;
  localStorage.clear();
  getConversation.mockImplementation((id) => Promise.resolve({ conversation: stored(id) }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** The tree the two routes render: the layout, with the page in its reading pane. */
function screen() {
  const openId = nav.params.conversationId;
  const page = openId ? (
    // Unkeyed, unlike the page: moving between conversations then also proves the
    // detail resets itself when its id changes under it.
    <ConversationDetail conversationId={openId} />
  ) : (
    <HistoryNewestDetail />
  );
  return (
    <LocaleProvider>
      <HistoryMasterDetail>{page}</HistoryMasterDetail>
    </LocaleProvider>
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(screen());
    await flush();
  });
}

/** A client-side move to another conversation: same root, so the layout stays. */
async function navigate(conversationId?: string): Promise<void> {
  nav.params = conversationId ? { conversationId } : {};
  await act(async () => {
    root?.render(screen());
    await flush();
  });
}

function field(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#history-search');
  if (!input) throw new Error('no search field');
  return input;
}

function type(value: string): void {
  const input = field();
  act(() => {
    // `HTMLInputElement.value` is a setter on the prototype, and React's own
    // tracker reads the last value it wrote — assigning directly makes React
    // treat the change as a no-op.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const summary = (id: string, startedAt: string, title: string) => ({
  conversationId: id,
  languages: ['vi', 'en'],
  startedAt,
  endedAt: startedAt,
  turnCount: 4,
  preview: 'xin chào',
  hasMinutes: false,
  pausedMs: 0,
  title,
  kind: 'one-way',
  hasRecording: false,
  speakerCount: 0,
  speakers: [],
});

const NEWEST = summary('c-1', '2026-09-03T12:00:00.000Z', 'Đặt bàn nhà hàng');
const OLDER = summary('c-2', '2026-09-03T09:00:00.000Z', 'Hỏi đường');
const TITLES: Record<string, string> = { 'c-1': NEWEST.title, 'c-2': OLDER.title };

function stored(id: string) {
  return {
    ...(id === 'c-2' ? OLDER : NEWEST),
    title: TITLES[id] ?? null,
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a',
        speakerLabel: null,
        sourceText: 'xin chào',
        displayText: null,
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
        offsetMs: null,
      },
    ],
    audioOffsetMs: null,
    audioDurationMs: null,
  };
}

const ONE = NEWEST;

/** Let the 250ms debounce fire and the fetch it starts settle. */
async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await flush();
  });
}

const current = () => container.querySelector('a[aria-current="page"]')?.getAttribute('href');
// The detail's title; the list's day headings are `h2`s too.
const heading = () => container.querySelector('header h2')?.textContent;

describe('the search field', () => {
  it('does not offer a search over an account with nothing in it', async () => {
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    await mount();
    expect(field().disabled).toBe(true);
  });

  it('offers the search once there is something to search', async () => {
    listConversations.mockResolvedValue({ conversations: [ONE], nextCursor: null });
    await mount();
    expect(field().disabled).toBe(false);
  });

  it('keeps the field live through a search that matched nothing and back', async () => {
    // The whole gesture, because the failure is in the SEAM between its steps.
    // Keyed on the raw term rather than the debounced one, the field disables
    // itself for 250ms the moment the query is cleared, and a disabled input is
    // blurred by the browser: the reader's remaining backspaces land nowhere.
    listConversations.mockResolvedValue({ conversations: [ONE], nextCursor: null });
    await mount();
    expect(field().disabled, 'with rows on screen').toBe(false);

    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    type('zzzz');
    await settle();
    expect(field().disabled, 'a query that matched nothing').toBe(false);

    listConversations.mockResolvedValue({ conversations: [ONE], nextCursor: null });
    type('');
    expect(field().disabled, 'the moment the query is cleared').toBe(false);

    await settle();
    expect(field().disabled, 'once the rows are back').toBe(false);
  });
});

describe('two panes on a wide content area', () => {
  beforeEach(() => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
  });

  it('opens the newest conversation on /history without changing the URL', async () => {
    await mount();

    expect(getConversation).toHaveBeenCalledWith('c-1');
    expect(heading()).toBe(NEWEST.title);
    expect(current()).toBe('/history/c-1');
    // A default, not a navigation: nothing pushed, nothing replaced.
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('marks the open conversation, with the dawn bar, and no other row', async () => {
    nav.params = { conversationId: 'c-2' };
    await mount();

    expect(current()).toBe('/history/c-2');
    expect(container.querySelectorAll('a[aria-current]').length).toBe(1);
    const bars = container.querySelectorAll('[data-slot="history-row-active-bar"]');
    expect(bars.length).toBe(1);
    expect(bars[0]?.closest('a')?.getAttribute('href')).toBe('/history/c-2');
    expect(heading()).toBe(OLDER.title);
  });

  it('keeps the list — and does not refetch it — while the reader moves between conversations', async () => {
    await mount();
    const list = container.querySelector('ul');
    expect(listConversations).toHaveBeenCalledTimes(1);

    await navigate('c-2');
    expect(heading()).toBe(OLDER.title);
    expect(current()).toBe('/history/c-2');

    await navigate('c-1');
    await navigate();

    expect(listConversations, 'the list was fetched again').toHaveBeenCalledTimes(1);
    // The same element: remounted, it would have lost its scroll position too.
    expect(container.querySelector('ul')).toBe(list);
  });

  it('hides the back link where the list is beside it', async () => {
    nav.params = { conversationId: 'c-2' };
    await mount();
    const back = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Back to history'),
    );
    // Hidden by the container width the panes switch at — a class, because the
    // first paint must already be right.
    expect(back?.className).toContain('@5xl:hidden');
  });

  it('opens the next newest after the newest is deleted from the menu', async () => {
    deleteConversation.mockResolvedValue(undefined);
    await mount();

    const more = container.querySelector<HTMLElement>('button[aria-label="More actions"]');
    await act(async () => {
      more?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      await flush();
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('Delete'),
    );
    await act(async () => {
      item?.click();
      // The strip opens once the menu has CLOSED, which Radix reports from a timeout
      // after its exit — so this waits out real time rather than a microtask.
      for (let i = 0; i < 10 && !container.querySelector('[role="alertdialog"]'); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    expect(
      container.querySelector('[role="alertdialog"]'),
      'the strip never opened',
    ).not.toBeNull();
    const confirm = [
      ...container.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
    ].find((button) => button.textContent === 'Delete');
    expect(confirm, 'the confirming press').toBeDefined();
    await act(async () => {
      confirm?.click();
      await flush();
    });

    expect(deleteConversation).toHaveBeenCalledWith('c-1');
    expect(nav.push).toHaveBeenCalledWith('/history');
    expect(container.querySelector('a[href="/history/c-1"]'), 'the deleted row').toBeNull();
    expect(heading()).toBe(OLDER.title);
  });
});

describe('one page on a narrow content area', () => {
  it('shows /history as the list alone, and fetches no conversation for a hidden pane', async () => {
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
    await mount();

    expect(getConversation).not.toHaveBeenCalled();
    expect(current()).toBeUndefined();
    expect(heading()).toBeUndefined();
  });

  it('draws no reading pane at all for an account with nothing stored', async () => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    await mount();

    expect(container.textContent).toContain('No conversations yet');
    expect(getConversation).not.toHaveBeenCalled();
    // The list takes the whole width: no pane-width class, and no width handle.
    expect(container.querySelector('[class*="--history-list-width"]')).toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});
