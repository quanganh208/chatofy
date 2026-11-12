// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The open conversation's topbar controls (Rename, Download ▾, `⋯`) and every list
 * row's `⋯` menu, with the rename and delete dialogs both open.
 *
 * Mounted through the whole History layout, wide, inside a host with the topbar's
 * two slots, so the list, the open conversation and its topbar are on screen
 * together: the claims worth testing are the ones that cross them — a rename in the
 * topbar shows in the row, a row's rename of the open conversation renames its
 * crumb, a row's delete leaves the pane alone unless it was the one open.
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

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn<(message: string, options?: { retry?: () => void }) => void>(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

const minutesState = vi.hoisted(() => ({ error: false }));
vi.mock('@/hooks/use-minutes', () => ({
  useMinutes: () => ({
    minutes: null,
    loading: false,
    error: minutesState.error,
    generate: vi.fn(),
  }),
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

/** Any callback — typed, so the matcher's `any` does not leak into the assertion. */
const anyFunction = expect.any(Function) as unknown as () => void;

const { HistoryMasterDetail } = await import('./history-master-detail');
const { LocaleProvider } = await import('@/i18n/provider');
const { ChromeSlotsTestHost } = await import('./chrome-slots-test-host');

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
  minutesState.error = false;
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

/** Real time for a step Radix finishes from a timeout or an animation end. */
async function settle(until: () => boolean): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 40 && !until(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

function screen() {
  return (
    <LocaleProvider>
      <ChromeSlotsTestHost>
        <HistoryMasterDetail>{null}</HistoryMasterDetail>
      </ChromeSlotsTestHost>
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

const topbar = (selector: string) =>
  container.querySelector<HTMLElement>(`[data-slot="topbar-actions"] ${selector}`);
const headerMenu = () => topbar('button[aria-label="More actions"]');
const headerRename = () => topbar('[data-action="rename"]');
const headerDownload = () => topbar('[data-action="download"]');
const crumb = () => container.querySelector('[data-slot="topbar-crumb"]')?.textContent;
const rowMenu = (title: string) =>
  container.querySelector<HTMLElement>(`button[aria-label="More actions for ${title}"]`);
const item = (action: string) =>
  document.querySelector<HTMLElement>(`[role="menuitem"][data-action="${action}"]`);
const menuActions = () =>
  [...document.querySelectorAll('[role="menu"] [data-action]')].map((el) =>
    el.getAttribute('data-action'),
  );
const rowTitle = (id: string) =>
  container.querySelector(`a[href^="/history/${id}"] p`)?.textContent;
const renameDialog = () => document.querySelector('[role="dialog"]');
const titleField = () => renameDialog()?.querySelector<HTMLInputElement>('input') ?? null;
const confirmDialog = () => document.querySelector('[role="alertdialog"]');

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

async function startRename(): Promise<void> {
  act(() => headerRename()?.click());
  await settle(() => titleField() !== null);
  expect(titleField(), 'the rename dialog never opened').not.toBeNull();
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

describe('the controls', () => {
  it('puts Rename, Download and a short menu in the topbar', async () => {
    await mount();
    expect(headerRename()?.textContent).toBe('Rename');
    expect(headerDownload()?.textContent).toBe('Download');
    await open(headerMenu());
    expect(menuActions()).toEqual(['copy', 'delete']);
  });

  it('downloads every format from the topbar, the recording only when there is one', async () => {
    await mount();
    await open(headerDownload());
    expect(menuActions()).toEqual([
      'download-txt',
      'download-md',
      'download-srt',
      'download-recording',
    ]);
  });

  it('offers a row everything in one menu, in order', async () => {
    await mount();
    await open(rowMenu('Đặt bàn nhà hàng'));
    expect(menuActions()).toEqual([
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
  it('saves from the topbar, renames the crumb and the row, and says so', async () => {
    api.renameConversation.mockResolvedValue({
      conversation: { ...NEWEST, title: 'Đặt bàn tối thứ Năm' },
    });
    await mount();
    await startRename();

    expect(titleField()?.value).toBe('Đặt bàn nhà hàng');
    expect(document.activeElement).toBe(titleField());
    type('  Đặt bàn tối thứ Năm  ');
    await submit();

    expect(api.renameConversation).toHaveBeenCalledWith('c-1', { title: 'Đặt bàn tối thứ Năm' });
    await settle(() => renameDialog() === null && document.activeElement === headerRename());
    expect(renameDialog()).toBeNull();
    expect(crumb()).toBe('Đặt bàn tối thứ Năm');
    expect(rowTitle('c-1')).toBe('Đặt bàn tối thứ Năm');
    expect(notify.success).toHaveBeenCalledWith('Conversation renamed', expect.anything());
    expect(document.activeElement).toBe(headerRename());
  });

  it('refuses an empty or over-long title without asking the server', async () => {
    await mount();
    await startRename();

    type('   ');
    await submit();
    expect(renameDialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      'A title cannot be empty.',
    );
    expect(titleField()?.getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(121));
    await submit();
    expect(renameDialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      'Keep the title to 120 characters.',
    );
    expect(api.renameConversation).not.toHaveBeenCalled();
  });

  it('keeps the dialog and the typed title, and says so, when the save fails', async () => {
    api.renameConversation.mockRejectedValue(new Error('offline'));
    await mount();
    await startRename();
    type('New name');
    await submit();

    expect(titleField()?.value).toBe('New name');
    expect(titleField()?.readOnly).toBe(false);
    expect(renameDialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not rename',
    );
    expect(rowTitle('c-1')).toBe('Đặt bàn nhà hàng');
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('cancels on Escape, back onto Rename, with the title unchanged', async () => {
    await mount();
    await startRename();
    type('Abandoned');
    await act(async () => {
      titleField()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    await settle(() => renameDialog() === null && document.activeElement === headerRename());
    expect(renameDialog()).toBeNull();
    expect(crumb()).toBe('Đặt bàn nhà hàng');
    expect(document.activeElement).toBe(headerRename());

    // Opened again, it starts from the stored title, not from what was abandoned.
    await startRename();
    expect(titleField()?.value).toBe('Đặt bàn nhà hàng');
  });

  it('renames a row in the same dialog, without opening it', async () => {
    api.renameConversation.mockResolvedValue({ conversation: { ...OLDER, title: 'Hỏi lối đi' } });
    await mount();
    await open(rowMenu('Hỏi đường'));
    await choose('rename');
    await settle(() => titleField() !== null);

    expect(nav.push).not.toHaveBeenCalled();
    expect(titleField()?.value).toBe('Hỏi đường');
    type('Hỏi lối đi');
    await submit();

    expect(api.renameConversation).toHaveBeenCalledWith('c-2', { title: 'Hỏi lối đi' });
    expect(rowTitle('c-2')).toBe('Hỏi lối đi');
    expect(crumb(), 'the open conversation is another one').toBe('Đặt bàn nhà hàng');
  });

  it('renames the crumb when a row renames the open conversation', async () => {
    api.renameConversation.mockResolvedValue({ conversation: { ...NEWEST, title: 'Bàn tối' } });
    await mount();
    await open(rowMenu('Đặt bàn nhà hàng'));
    await choose('rename');
    await settle(() => titleField() !== null);
    type('Bàn tối');
    await submit();

    expect(crumb()).toBe('Bàn tối');
    expect(rowTitle('c-1')).toBe('Bàn tối');
  });
});

describe('copy and downloads', () => {
  it('copies the text transcript and confirms it in a toast', async () => {
    await mount();
    await open(headerMenu());
    await choose('copy');

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain('[0:00] Speaker A\nxin chào\n→ hello');
    expect(notify.success).toHaveBeenCalledWith('Transcript copied', {
      id: 'conversation-file-c-1',
    });
  });

  it('downloads a .txt through an object URL, with a BOM, and names the file in a toast', async () => {
    await mount();
    await open(headerDownload());
    await choose('download-txt');

    expect(saved.map((file) => file.name)).toEqual(['dat-ban-nha-hang-2026-11-12.txt']);
    const bytes = new Uint8Array(await saved[0]!.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(notify.success).toHaveBeenCalledWith('Downloaded dat-ban-nha-hang-2026-11-12.txt', {
      id: 'conversation-file-c-1',
    });
    // Not on the next tick: a slow engine may still be reading the blob. When it IS
    // revoked is `save-file.spec.ts`'s to pin.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(revoked).toEqual([]);
  });

  it('reads the minutes itself for a .md when the screen could not load them', async () => {
    minutesState.error = true;
    api.getConversation.mockImplementation((id) =>
      Promise.resolve({ conversation: { ...stored(id), hasMinutes: true } }),
    );
    api.getMinutes.mockResolvedValue({
      minutes: {
        conversationId: 'c-1',
        status: 'ready',
        summary: 'A table was booked.',
        keyPoints: [],
        decisions: [],
        actionItems: [],
        generatedAt: null,
        model: null,
      },
    });
    await mount();
    await open(headerDownload());
    await choose('download-md');

    expect(api.getMinutes).toHaveBeenCalledWith('c-1');
    expect(await saved[0]!.blob.text()).toContain('## Minutes\n\n### Summary\nA table was booked.');
  });

  it('writes no .md, and offers a retry, when those minutes fail to load again', async () => {
    minutesState.error = true;
    api.getConversation.mockImplementation((id) =>
      Promise.resolve({ conversation: { ...stored(id), hasMinutes: true } }),
    );
    api.getMinutes.mockRejectedValue(new Error('offline'));
    await mount();
    await open(headerDownload());
    await choose('download-md');

    expect(saved).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('Could not download it. Try again.', {
      id: 'conversation-file-c-1',
      retry: anyFunction,
    });

    // The retry is the same download, and this time the minutes answer.
    api.getMinutes.mockResolvedValue({
      minutes: {
        conversationId: 'c-1',
        status: 'ready',
        summary: 'Second try.',
        keyPoints: [],
        decisions: [],
        actionItems: [],
        generatedAt: null,
        model: null,
      },
    });
    await act(async () => {
      notify.error.mock.calls[0]?.[1]?.retry?.();
      await flush();
    });
    expect(await saved[0]!.blob.text()).toContain('Second try.');
  });

  it('offers Subtitles disabled, with the reason, when a line has no time', async () => {
    api.getConversation.mockImplementation((id) =>
      Promise.resolve({ conversation: stored(id, null) }),
    );
    await mount();
    await open(headerDownload());
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

  it('copies an uncached row inside the gesture, from the pending text', async () => {
    // The ClipboardItem is handed over before the fetch lands; the browser fills it.
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, write },
      configurable: true,
    });
    const items: Record<string, Promise<Blob>>[] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(data: Record<string, Promise<Blob>>) {
          items.push(data);
        }
      },
    );
    await mount();
    await open(rowMenu('Hỏi đường'));
    await choose('copy');

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(await (await items[0]!['text/plain']!).text()).toContain('Hỏi đường\n');
    vi.unstubAllGlobals();
  });

  it('says "Copying…" while a row copy is still fetching, and holds Delete back', async () => {
    await mount();
    api.getConversation.mockImplementation(() => new Promise(() => {}));
    await open(rowMenu('Hỏi đường'));
    await choose('copy');

    expect(notify.info).toHaveBeenCalledWith('Copying…', { id: 'conversation-file-c-2' });
    await open(rowMenu('Hỏi đường'));
    expect(item('delete')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('saves the recording under the extension its type names', async () => {
    api.fetchConversationAudio.mockResolvedValue(new Blob(['x'], { type: 'audio/webm' }));
    await mount();
    await open(headerDownload());
    await choose('download-recording');
    expect(api.fetchConversationAudio).toHaveBeenCalledWith('c-1');
    expect(saved.map((file) => file.name)).toEqual(['dat-ban-nha-hang-2026-11-12.webm']);
  });

  it('says so, with a retry, when the recording cannot be fetched', async () => {
    api.fetchConversationAudio.mockRejectedValue(new Error('offline'));
    await mount();
    await open(headerDownload());
    await choose('download-recording');
    expect(saved).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('Could not download it. Try again.', {
      id: 'conversation-file-c-1',
      retry: anyFunction,
    });
  });
});

describe('deleting from a row', () => {
  async function confirmRowDelete(title: string): Promise<void> {
    await open(rowMenu(title));
    await choose('delete');
    await settle(() => confirmDialog() !== null);
    const dialog = confirmDialog();
    expect(dialog, 'the confirmation').not.toBeNull();
    expect(dialog?.textContent).toContain(`Delete “${title}”?`);
    expect(document.activeElement?.textContent).toBe('Cancel');
    const press = [...dialog!.querySelectorAll<HTMLElement>('button')].find(
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
    expect(crumb()).toBe('Đặt bàn nhà hàng');
    expect(notify.success).toHaveBeenCalledWith('Conversation deleted');
    await settle(() => document.activeElement?.getAttribute('href') === '/history/c-3');
    expect(document.activeElement?.getAttribute('href')).toBe('/history/c-3');
  });

  it('goes the topbar delete way when the row is the open conversation', async () => {
    api.deleteConversation.mockResolvedValue(undefined);
    await mount();
    await confirmRowDelete('Đặt bàn nhà hàng');

    expect(nav.replace).toHaveBeenCalledWith('/history');
    expect(container.querySelector('a[href^="/history/c-1"]')).toBeNull();
    await settle(() => crumb() === 'Hỏi đường');
    expect(crumb()).toBe('Hỏi đường');
    await settle(() => document.activeElement?.getAttribute('aria-label') === 'Hỏi đường');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Hỏi đường');
  });

  it('keeps the row and says so in the dialog when the server refuses', async () => {
    api.deleteConversation.mockRejectedValue(new Error('offline'));
    await mount();
    await confirmRowDelete('Hỏi đường');
    expect(container.querySelector('a[href^="/history/c-2"]')).not.toBeNull();
    expect(confirmDialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not delete',
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});
