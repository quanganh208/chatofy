// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `⋯` menu, in the header of the open conversation and on every list row.
 *
 * Mounted through the whole History layout, wide, so the list and the open
 * conversation are on screen together: the claims worth testing are the ones that
 * cross the two — a rename in the header shows in the row, a row's rename opens
 * the conversation, a row's delete leaves the pane alone unless it was the one open.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  listConversations: vi.fn<() => Promise<unknown>>(),
  getConversation: vi.fn<(id: string) => Promise<unknown>>(),
  deleteConversation: vi.fn<(id: string) => Promise<void>>(),
  renameConversation: vi.fn<(id: string, body: { title: string }) => Promise<unknown>>(),
  fetchConversationAudio: vi.fn<(id: string) => Promise<Blob>>(),
  getMinutes: vi.fn<(id: string) => Promise<unknown>>(),
}));
vi.mock('@/clients/api-client', () => ({
  listConversations: () => api.listConversations(),
  getConversation: (id: string) => api.getConversation(id),
  deleteConversation: (id: string) => api.deleteConversation(id),
  renameConversation: (id: string, body: { title: string }) => api.renameConversation(id, body),
  fetchConversationAudio: (id: string) => api.fetchConversationAudio(id),
  getMinutes: (id: string) => api.getMinutes(id),
}));

vi.mock('@/hooks/use-minutes', () => ({
  useMinutes: () => ({ minutes: null, loading: false, error: false, generate: vi.fn() }),
}));

const nav = vi.hoisted(() => {
  const params: { conversationId?: string } = {};
  const push = vi.fn<(url: string) => void>();
  const replace = vi.fn<(url: string) => void>();
  return { params, push, replace, router: { push, replace } };
});
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () =>
    nav.params.conversationId ? `/history/${nav.params.conversationId}` : '/history',
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => nav.params,
}));

vi.mock('./use-container-wide', () => ({
  WIDE_PROBE_CLASS: 'hidden @5xl:block',
  useContainerWide: () => true,
}));

const { HistoryMasterDetail } = await import('./history-master-detail');
const { LocaleProvider } = await import('@/i18n/provider');

const summary = (id: string, startedAt: string, title: string, hasRecording: boolean) => ({
  conversationId: id,
  languages: ['vi', 'en'],
  startedAt,
  endedAt: '2026-11-12T08:00:00.000Z',
  turnCount: 1,
  preview: 'xin chào',
  hasMinutes: false,
  pausedMs: 0,
  title,
  kind: 'two-way',
  hasRecording,
  speakerCount: 0,
  speakers: [],
});

const NEWEST = summary('c-1', '2026-11-12T07:58:00.000Z', 'Đặt bàn nhà hàng', true);
const OLDER = summary('c-2', '2026-11-12T05:40:00.000Z', 'Hỏi đường', false);
const THIRD = summary('c-3', '2026-11-12T04:10:00.000Z', 'Check-in khách sạn', false);

function stored(id: string, offsetMs: number | null = 0) {
  const base = id === 'c-1' ? NEWEST : id === 'c-2' ? OLDER : THIRD;
  return {
    ...base,
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a',
        speakerLabel: null,
        sourceText: 'xin chào',
        displayText: null,
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
        offsetMs,
      },
    ],
    audioOffsetMs: null,
    audioDurationMs: null,
  };
}

let root: Root | undefined;
let container: HTMLElement;
let writeText: ReturnType<typeof vi.fn>;
let saved: { name: string; blob: Blob }[];
let revoked: string[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  nav.params = {};
  localStorage.clear();
  api.listConversations.mockResolvedValue({
    conversations: [NEWEST, OLDER, THIRD],
    nextCursor: null,
  });
  api.getConversation.mockImplementation((id) => Promise.resolve({ conversation: stored(id) }));

  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  // The download path: an object URL per file, a click on a temporary link, and
  // the URL revoked afterwards. The link's click is captured rather than followed.
  saved = [];
  revoked = [];
  let pending: Blob | undefined;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    pending = blob;
    return `blob:test-${saved.length}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: pending! });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function screen() {
  return (
    <LocaleProvider>
      <HistoryMasterDetail>{null}</HistoryMasterDetail>
    </LocaleProvider>
  );
}

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(screen());
    await flush();
  });
}

async function navigate(conversationId: string): Promise<void> {
  nav.params = { conversationId };
  await act(async () => {
    root?.render(screen());
    await flush();
  });
}

const headerMenu = () =>
  container.querySelector<HTMLElement>('header button[aria-label="More actions"]');
const rowMenu = (title: string) =>
  container.querySelector<HTMLElement>(`button[aria-label="More actions for ${title}"]`);
const item = (action: string) =>
  document.querySelector<HTMLElement>(`[role="menuitem"][data-action="${action}"]`);
const rowTitle = (id: string) =>
  container.querySelector(`a[href^="/history/${id}"] p`)?.textContent;
const titleField = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Conversation title"]');

/** Radix opens a menu on `pointerdown`, not on click. */
async function open(trigger: HTMLElement | null): Promise<void> {
  expect(trigger, 'no menu trigger').not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await flush();
  });
}

/** Choose an item and wait out the menu's close, which some items act after. */
async function choose(action: string): Promise<void> {
  const target = item(action);
  expect(target, `no ${action} item`).not.toBeNull();
  await act(async () => {
    target?.click();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();
  });
}

function type(value: string): void {
  const input = titleField()!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    titleField()?.form?.requestSubmit();
    await flush();
  });
}

describe('the menu', () => {
  it('offers the actions in order, with Download recording only for a recording', async () => {
    await mount();
    await open(headerMenu());
    const actions = [...document.querySelectorAll('[data-action]')].map((el) =>
      el.getAttribute('data-action'),
    );
    expect(actions).toEqual([
      'rename',
      'copy',
      'download-transcript',
      'download-recording',
      'delete',
    ]);
    expect(document.querySelector('[role="separator"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    await open(rowMenu('Hỏi đường'));
    expect(item('download-recording'), 'c-2 has no recording').toBeNull();
  });

  it('sits beside the row link, not inside it, and opening it does not navigate', async () => {
    await mount();
    const trigger = rowMenu('Hỏi đường');
    expect(trigger?.closest('a')).toBeNull();
    expect(trigger?.closest('li')?.querySelector('a[href^="/history/c-2"]')).not.toBeNull();

    await open(trigger);
    await act(async () => {
      trigger?.click();
      await flush();
    });
    expect(nav.push).not.toHaveBeenCalled();
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/history/c-1',
    );
  });
});

describe('renaming', () => {
  it('saves from the header, updates the header and the row, and returns to the title', async () => {
    api.renameConversation.mockResolvedValue({
      conversation: { ...NEWEST, title: 'Đặt bàn tối thứ Năm' },
    });
    await mount();
    await open(headerMenu());
    await choose('rename');

    expect(titleField()?.value).toBe('Đặt bàn nhà hàng');
    expect(document.activeElement).toBe(titleField());
    type('  Đặt bàn tối thứ Năm  ');
    await submit();

    expect(api.renameConversation).toHaveBeenCalledWith('c-1', { title: 'Đặt bàn tối thứ Năm' });
    expect(titleField()).toBeNull();
    expect(container.querySelector('header h2')?.textContent).toBe('Đặt bàn tối thứ Năm');
    expect(rowTitle('c-1')).toBe('Đặt bàn tối thứ Năm');
    expect(document.activeElement).toBe(container.querySelector('header h2'));
  });

  it('refuses an empty or over-long title without asking the server', async () => {
    await mount();
    await open(headerMenu());
    await choose('rename');

    type('   ');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('A title cannot be empty.');
    expect(titleField()?.getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(121));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Keep the title to 120 characters.',
    );
    expect(api.renameConversation).not.toHaveBeenCalled();
  });

  it('keeps the field and says so when the save fails', async () => {
    api.renameConversation.mockRejectedValue(new Error('offline'));
    await mount();
    await open(headerMenu());
    await choose('rename');
    type('New name');
    await submit();

    expect(titleField()?.value).toBe('New name');
    expect(titleField()?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not rename');
    expect(rowTitle('c-1')).toBe('Đặt bàn nhà hàng');
  });

  it('cancels on Escape, back onto the unchanged title', async () => {
    await mount();
    await open(headerMenu());
    await choose('rename');
    await act(async () => {
      titleField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    expect(titleField()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('header h2'));
  });

  it('opens the conversation from a row and starts the edit in its header', async () => {
    await mount();
    await open(rowMenu('Hỏi đường'));
    await choose('rename');
    expect(nav.push).toHaveBeenCalledWith('/history/c-2');

    await navigate('c-2');
    expect(titleField()?.value).toBe('Hỏi đường');
  });
});

describe('copy and downloads', () => {
  it('copies the text transcript and confirms it', async () => {
    await mount();
    await open(headerMenu());
    await choose('copy');

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain('[0:00] Speaker A\nxin chào\n→ hello');
    expect(container.querySelector('header [aria-live="polite"]')?.textContent).toBe(
      'Transcript copied',
    );
  });

  it('downloads a .txt through an object URL, with a BOM, and revokes the URL', async () => {
    await mount();
    await open(headerMenu());
    await act(async () => {
      item('download-transcript')?.click();
      await flush();
    });
    await choose('download-txt');

    expect(saved.map((file) => file.name)).toEqual(['dat-ban-nha-hang-2026-11-12.txt']);
    const bytes = new Uint8Array(await saved[0]!.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(revoked).toEqual(['blob:test-0']);
  });

  it('offers Subtitles disabled, with the reason, when a line has no time', async () => {
    api.getConversation.mockImplementation((id) =>
      Promise.resolve({ conversation: stored(id, null) }),
    );
    await mount();
    await open(headerMenu());
    await act(async () => {
      item('download-transcript')?.click();
      await flush();
    });
    const srt = item('download-srt');
    expect(srt?.getAttribute('aria-disabled')).toBe('true');
    expect(srt?.textContent).toContain('Needs a time on every line');
  });

  it('fetches a row conversation only when an item is chosen, and once', async () => {
    await mount();
    expect(api.getConversation).toHaveBeenCalledTimes(1);

    await open(rowMenu('Hỏi đường'));
    expect(api.getConversation).toHaveBeenCalledTimes(1);
    await choose('copy');
    expect(api.getConversation).toHaveBeenLastCalledWith('c-2');
    expect(writeText).toHaveBeenCalledTimes(1);

    await open(rowMenu('Hỏi đường'));
    await choose('copy');
    expect(api.getConversation).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('saves the recording under the extension its type names', async () => {
    api.fetchConversationAudio.mockResolvedValue(new Blob(['x'], { type: 'audio/webm' }));
    await mount();
    await open(headerMenu());
    await choose('download-recording');
    expect(api.fetchConversationAudio).toHaveBeenCalledWith('c-1');
    expect(saved.map((file) => file.name)).toEqual(['dat-ban-nha-hang-2026-11-12.webm']);
  });

  it('says so when the recording cannot be fetched', async () => {
    api.fetchConversationAudio.mockRejectedValue(new Error('offline'));
    await mount();
    await open(headerMenu());
    await choose('download-recording');
    expect(saved).toEqual([]);
    expect(container.querySelector('header [aria-live="polite"]')?.textContent).toBe(
      'Could not download it. Try again.',
    );
  });
});

describe('deleting from a row', () => {
  async function confirmRowDelete(title: string): Promise<void> {
    await open(rowMenu(title));
    await choose('delete');
    const strip = container.querySelector('li [role="alertdialog"]');
    expect(strip, 'the strip under the row').not.toBeNull();
    const press = [...strip!.querySelectorAll<HTMLElement>('button')].find(
      (button) => button.textContent === 'Delete',
    );
    await act(async () => {
      press?.click();
      await flush();
    });
  }

  it('removes a row that is not open and leaves focus on its neighbour', async () => {
    api.deleteConversation.mockResolvedValue(undefined);
    await mount();
    await confirmRowDelete('Hỏi đường');

    expect(api.deleteConversation).toHaveBeenCalledWith('c-2');
    expect(container.querySelector('a[href^="/history/c-2"]')).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(container.querySelector('header h2')?.textContent).toBe('Đặt bàn nhà hàng');
    expect(document.activeElement?.getAttribute('href')).toBe('/history/c-3');
  });

  it('goes the header delete way when the row is the open conversation', async () => {
    api.deleteConversation.mockResolvedValue(undefined);
    await mount();
    await confirmRowDelete('Đặt bàn nhà hàng');

    expect(nav.replace).toHaveBeenCalledWith('/history');
    expect(container.querySelector('a[href^="/history/c-1"]')).toBeNull();
    expect(container.querySelector('header h2')?.textContent).toBe('Hỏi đường');
    expect(document.activeElement?.textContent).toBe('Hỏi đường');
  });

  it('keeps the row and says so when the server refuses', async () => {
    api.deleteConversation.mockRejectedValue(new Error('offline'));
    await mount();
    await confirmRowDelete('Hỏi đường');
    expect(container.querySelector('a[href^="/history/c-2"]')).not.toBeNull();
    expect(container.querySelector('li [role="alert"]')?.textContent).toContain('Could not delete');
  });
});
