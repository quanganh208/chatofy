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
  const push = vi.fn<(url: string) => void>();
  const replace = vi.fn<(url: string) => void>();
  // One object, as Next's router is: a new one per render would re-run every effect
  // that depends on it, which the real app never does.
  return { params, query: '', push, replace, router: { push, replace } };
});
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () =>
    nav.params.conversationId ? `/history/${nav.params.conversationId}` : '/history',
  useSearchParams: () => new URLSearchParams(nav.query),
  useParams: () => nav.params,
}));

const layout = vi.hoisted(() => ({ wide: false }));
vi.mock('./use-container-wide', () => ({
  WIDE_PROBE_CLASS: 'hidden @5xl:block',
  useContainerWide: () => layout.wide,
}));

const { HistoryMasterDetail } = await import('./history-master-detail');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  container = document.createElement('div');
  document.body.append(container);
  nav.params = {};
  nav.query = '';
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

/**
 * The tree both routes render: the layout, which reads the id from the URL and draws
 * the conversation itself. The pages render nothing.
 */
function screen() {
  return (
    <LocaleProvider>
      <HistoryMasterDetail>{null}</HistoryMasterDetail>
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
async function navigate(conversationId?: string, query = nav.query): Promise<void> {
  nav.params = conversationId ? { conversationId } : {};
  nav.query = query;
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

    await deleteOpenConversation();

    expect(deleteConversation).toHaveBeenCalledWith('c-1');
    // Replaced, not pushed: Back must not lead to a conversation that is gone.
    expect(nav.replace).toHaveBeenCalledWith('/history');
    expect(nav.push).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/history/c-1"]'), 'the deleted row').toBeNull();
    expect(heading()).toBe(OLDER.title);
    // The next conversation's title takes the focus the delete took away.
    expect(document.activeElement?.textContent).toBe(OLDER.title);
  });

  it('keeps the newest open when it is opened from its own row', async () => {
    await mount();
    const article = container.querySelector('header h2');
    expect(getConversation).toHaveBeenCalledTimes(1);

    await navigate('c-1');

    // `/history` and `/history/c-1` are one mounted conversation: no second fetch,
    // and the same element — its tab, scroll and audio with it.
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(container.querySelector('header h2')).toBe(article);
  });

  it('keeps its open tab when the newest is opened from its own row', async () => {
    await mount();
    await act(async () => {
      minutesTab()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await flush();
    });
    expect(minutesTab()?.getAttribute('aria-selected')).toBe('true');

    await navigate('c-1');
    expect(minutesTab()?.getAttribute('aria-selected')).toBe('true');
  });

  it('does not swap the open conversation when a search changes the newest match', async () => {
    await mount();
    expect(heading()).toBe(NEWEST.title);

    listConversations.mockResolvedValue({ conversations: [OLDER], nextCursor: null });
    type('hỏi');
    await settle();

    // The list follows the search; the pane stays on what is being read.
    expect(container.querySelector('a[href="/history/c-1"]')).toBeNull();
    expect(heading()).toBe(NEWEST.title);
    expect(getConversation).toHaveBeenCalledTimes(1);
  });

  it('answers a conversation id on an empty account with "no longer here"', async () => {
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    getConversation.mockRejectedValue(new Error('404'));
    nav.params = { conversationId: 'gone' };
    await mount();

    expect(container.textContent).toContain('no longer here');
    expect(container.textContent).toContain('No conversations yet');
  });

  it('brings a deep-linked row into the list view once the list arrives', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const scrolled = () =>
      scroll.mock.contexts.map((element) => (element as HTMLElement).getAttribute('href'));

    nav.params = { conversationId: 'c-2' };
    await mount();
    expect(scrolled()).toEqual(['/history/c-2']);
    await navigate('c-1');
    expect(scrolled(), 'only on the first load').toEqual(['/history/c-2']);
    scroll.mockRestore();
  });
});

describe('a row clicked while a search is still being typed', () => {
  beforeEach(() => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
  });

  it('opens the row with the typed term, and the debounce does not overwrite it', async () => {
    await mount();
    type('xin');

    // Inside the 250ms window: the row's link already carries what was typed.
    const row = container.querySelector<HTMLAnchorElement>('a[href^="/history/c-2"]');
    expect(row?.getAttribute('href')).toBe('/history/c-2?q=xin');

    // The click itself; the browser default is prevented so happy-dom does not
    // try to load the page, which leaves the row's own handler to run.
    row?.addEventListener('click', (event) => event.preventDefault(), { once: true });
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
    await settle();

    // The navigation is still in flight (the pathname has not changed), so the
    // search must not `replace` the list's own URL over it.
    expect(nav.replace).not.toHaveBeenCalled();

    await navigate('c-2', 'q=xin');
    expect(nav.replace, 'the URL already says it').not.toHaveBeenCalled();
    expect(field().value).toBe('xin');
  });

  it('writes the URL as usual when no row was clicked', async () => {
    await mount();
    type('xin');
    await settle();
    expect(nav.replace).toHaveBeenCalledWith('/history?q=xin');
  });

  it('lets a navigation without the term — the sidebar — reset the search', async () => {
    nav.params = { conversationId: 'c-2' };
    nav.query = 'q=xin';
    await mount();
    expect(field().value).toBe('xin');

    await navigate(undefined, '');
    expect(field().value).toBe('');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe('the URL term the search did not write', () => {
  beforeEach(() => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
  });

  it('clears the box when /history?q=… navigates to plain /history', async () => {
    nav.query = 'q=xin';
    await mount();
    expect(field().value).toBe('xin');
    const fetches = listConversations.mock.calls.length;

    // The sidebar's History item: same pathname, no term.
    await navigate(undefined, '');
    expect(field().value).toBe('');
    // The filter goes with it: the unfiltered list is fetched again.
    expect(listConversations.mock.calls.length).toBeGreaterThan(fetches);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('adopts a term that arrives by navigation on the same page (Back)', async () => {
    await mount();
    await navigate(undefined, 'q=hỏi');
    expect(field().value).toBe('hỏi');
  });

  it('does not rewind typing when its own earlier write lands late', async () => {
    await mount();
    type('xi');
    await settle();
    expect(nav.replace).toHaveBeenLastCalledWith('/history?q=xi');
    type('xin');
    await settle();
    expect(nav.replace).toHaveBeenLastCalledWith('/history?q=xin');

    // The first write arrives after the reader typed on.
    await navigate(undefined, 'q=xi');
    expect(field().value).toBe('xin');
  });
});

/**
 * Land one of the search's own `replace` writes, as the router would — on the same
 * page, with its `?q=`. Writes are not landed by themselves, so a spec chooses which
 * arrive, in what order, and which the router discarded.
 */
async function land(url: string): Promise<void> {
  expect(nav.replace.mock.calls.map(([written]) => written)).toContain(url);
  await navigate(nav.params.conversationId, url.split('?')[1] ?? '');
}

const urlTerm = () => new URLSearchParams(nav.query).get('q') ?? '';

describe('the search writes landing late, early or never', () => {
  beforeEach(() => {
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
  });

  it('forgets a write the router discarded, so a later sidebar reset still clears', async () => {
    nav.query = 'q=foo';
    await mount();

    // Cleared, then typed again within one round trip: the router keeps only the
    // newest navigation, so the clear never lands.
    type('');
    await settle();
    expect(nav.replace).toHaveBeenLastCalledWith('/history');
    type('b');
    await settle();
    expect(nav.replace).toHaveBeenLastCalledWith('/history?q=b');
    await land('/history?q=b');
    expect(field().value).toBe('b');

    // The sidebar's History: plain `/history`. The discarded clear must not be
    // waiting in the queue to swallow it.
    await navigate(undefined, '');
    expect(field().value).toBe('');
  });

  it('rewrites the box term when an older write lands after the box moved on', async () => {
    await mount();
    type('a');
    await settle();
    // Cleared before `a` arrived: the URL still shows no term, so nothing is written.
    type('');
    await settle();
    expect(nav.replace).toHaveBeenCalledTimes(1);

    await land('/history?q=a');
    // URL `a`, box empty: the box's term is written again, and lands.
    expect(nav.replace).toHaveBeenLastCalledWith('/history');
    await land('/history');
    expect(field().value).toBe('');
    expect(urlTerm()).toBe(field().value);
  });

  // Next discards an older pending navigation when a newer one starts, so this
  // order should not happen in the app. If it ever does, the late term is treated
  // as a navigation and adopted: the box follows the URL back to it rather than
  // the two disagreeing. Agreement is the guarantee; the typed term winning is not.
  it('adopts an older write that lands after a newer one, keeping URL and box in step', async () => {
    await mount();
    type('a');
    await settle();
    type('ab');
    await settle();

    await land('/history?q=ab');
    await land('/history?q=a');

    expect(field().value).toBe('a');
    expect(urlTerm()).toBe('a');
  });
});

describe('re-clicking the open row', () => {
  it('does not hold back the URL write of a search typed afterwards', async () => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
    nav.params = { conversationId: 'c-1' };
    await mount();

    const row = container.querySelector<HTMLAnchorElement>('a[href^="/history/c-1"]');
    row?.addEventListener('click', (event) => event.preventDefault(), { once: true });
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });

    type('xin');
    await settle();
    expect(nav.replace).toHaveBeenCalledWith('/history/c-1?q=xin');
  });
});

describe('focus after a delete', () => {
  it('is taken by a not-found state, so a later load does not steal it', async () => {
    layout.wide = true;
    listConversations.mockResolvedValue({ conversations: [NEWEST, OLDER], nextCursor: null });
    getConversation.mockImplementation((id) =>
      id === 'c-2'
        ? Promise.reject(new Error('404'))
        : Promise.resolve({ conversation: stored(id) }),
    );
    deleteConversation.mockResolvedValue(undefined);
    await mount();

    await deleteOpenConversation();
    await settle();
    // The next newest is gone too: its not-found state holds the focus.
    expect(document.activeElement?.textContent).toContain('no longer here');

    // Much later, the reader opens something else: its title does not take focus,
    // because the request was already spent.
    await navigate('c-1');
    expect(heading()).toBe(NEWEST.title);
    expect(document.activeElement).not.toBe(container.querySelector('header h2'));
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

  it('answers a conversation id on an empty account with "no longer here" and a way back', async () => {
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    getConversation.mockRejectedValue(new Error('404'));
    nav.params = { conversationId: 'gone' };
    await mount();

    expect(container.textContent).toContain('no longer here');
    expect(
      [...container.querySelectorAll('a')].some((a) => a.textContent?.includes('Back to history')),
    ).toBe(true);
  });

  it('lands on the list, with focus on it, after deleting the last conversation', async () => {
    listConversations.mockResolvedValue({ conversations: [NEWEST], nextCursor: null });
    deleteConversation.mockResolvedValue(undefined);
    nav.params = { conversationId: 'c-1' };
    await mount();

    await deleteOpenConversation();
    // Until the replace lands the URL still names it: the frame is not blank.
    expect(container.textContent).toContain(NEWEST.title);

    await navigate();
    expect(container.textContent).toContain('No conversations yet');
    expect(document.activeElement?.getAttribute('role')).toBe('region');
  });
});

describe('an account with nothing stored', () => {
  it.each([false, true])('draws no reading pane at all (wide: %s)', async (wide) => {
    layout.wide = wide;
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    await mount();

    expect(container.textContent).toContain('No conversations yet');
    expect(getConversation).not.toHaveBeenCalled();
    // The list takes the whole width: no pane-width class, and no width handle.
    expect(container.querySelector('[class*="--history-list-width"]')).toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});

function minutesTab(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="tab"][id$="-trigger-minutes"]');
}

/** `⋯` → Delete → the destructive press, the way a pointer does it. */
async function deleteOpenConversation(): Promise<void> {
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
  const confirm = [...container.querySelectorAll<HTMLElement>('[role="alertdialog"] button')].find(
    (button) => button.textContent === 'Delete',
  );
  expect(confirm, 'the confirming press').toBeDefined();
  await act(async () => {
    confirm?.click();
    await flush();
  });
}
