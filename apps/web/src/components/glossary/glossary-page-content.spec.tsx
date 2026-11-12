// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_CODES } from '@chatofy/types';
import type { Glossary, GlossaryItem } from '@chatofy/types';

/**
 * The glossary screen through its dialogs and toasts: New glossary in the topbar,
 * Add and Edit term, the delete confirms, and the active switch.
 *
 * The API is a small in-memory store behind the client mock, so a reload after a
 * write lists what the write left — which is what the edit's add-then-delete needs
 * to be checked against.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => ({
  glossaries: [] as Glossary[],
  items: [] as GlossaryItem[],
  failDeleteItem: false,
  failPatch: false,
}));

const api = vi.hoisted(() => ({
  saveGlossary: vi.fn(),
  patchGlossary: vi.fn(),
  deleteGlossary: vi.fn(),
  addGlossaryItem: vi.fn(),
  deleteGlossaryItem: vi.fn(),
}));

vi.mock('@/clients/api-client', () => ({
  listGlossaries: async () => {
    await Promise.resolve();
    return { glossaries: store.glossaries.map((g) => ({ ...g })) };
  },
  listGlossaryItems: async () => {
    await Promise.resolve();
    return { items: store.items.map((i) => ({ ...i })) };
  },
  saveGlossary: async (id: string, body: { name: string; description: string | null }) => {
    // Answered on a later turn, as the network would.
    await Promise.resolve();
    api.saveGlossary(id, body);
    const glossary: Glossary = {
      id,
      name: body.name,
      description: body.description,
      sourceLang: 'vi',
      isActive: true,
      itemCount: 0,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    };
    store.glossaries = [glossary, ...store.glossaries];
    return { glossary };
  },
  patchGlossary: async (id: string, body: { isActive: boolean }) => {
    // Answered on a later turn, as the network would.
    await Promise.resolve();
    api.patchGlossary(id, body);
    if (store.failPatch) throw new Error('offline');
    store.glossaries = store.glossaries.map((g) =>
      g.id === id ? { ...g, isActive: body.isActive } : g,
    );
    return { glossary: store.glossaries.find((g) => g.id === id) };
  },
  deleteGlossary: async (id: string) => {
    // Answered on a later turn, as the network would.
    await Promise.resolve();
    api.deleteGlossary(id);
    store.glossaries = store.glossaries.filter((g) => g.id !== id);
  },
  addGlossaryItem: async (glossaryId: string, body: Omit<GlossaryItem, 'id'>) => {
    // Answered on a later turn, as the network would.
    await Promise.resolve();
    api.addGlossaryItem(glossaryId, body);
    const item = { ...body, id: `item-${store.items.length + 1}`, glossaryId };
    store.items = [...store.items, item];
    return { item };
  },
  deleteGlossaryItem: async (glossaryId: string, itemId: string) => {
    // Answered on a later turn, as the network would.
    await Promise.resolve();
    api.deleteGlossaryItem(glossaryId, itemId);
    if (store.failDeleteItem) throw new Error('offline');
    store.items = store.items.filter((i) => i.id !== itemId);
  },
}));

const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { undo?: () => void }) => void>(),
  error: vi.fn<(message: string, options?: { retry?: () => void }) => void>(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

/** Any callback — typed, so the matcher's `any` does not leak into the assertion. */
const anyFunction = expect.any(Function) as unknown as () => void;

const { GlossaryPageContent } = await import('./glossary-page-content');
const { GlossariesProvider } = await import('@/hooks/use-glossaries');
const { ChromeSlotsTestHost } = await import('@/components/history/chrome-slots-test-host');
const { LocaleProvider } = await import('@/i18n/provider');

const GLOSSARY: Glossary = {
  id: 'g-1',
  name: 'Thesis defense',
  description: null,
  sourceLang: 'vi',
  isActive: true,
  itemCount: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const TERM: GlossaryItem = {
  id: 'item-0',
  glossaryId: 'g-1',
  original: 'đồ án',
  translation: 'thesis',
  targetLang: 'en',
  notes: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  store.glossaries = [];
  store.items = [];
  store.failDeleteItem = false;
  store.failPatch = false;
  vi.stubGlobal('crypto', { ...crypto, randomUUID: () => '11111111-1111-4111-8111-111111111111' });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/** Real time for a step Radix finishes from a timeout or an animation end. */
async function settle(until: () => boolean): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 40 && !until(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider locale="en">
        <ChromeSlotsTestHost>
          <GlossariesProvider>
            <GlossaryPageContent />
          </GlossariesProvider>
        </ChromeSlotsTestHost>
      </LocaleProvider>,
    );
    await flush();
  });
}

const button = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const confirm = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const crumb = () => container.querySelector('[data-slot="topbar-crumb"]')?.textContent;

async function press(target: HTMLElement | undefined | null): Promise<void> {
  expect(target, 'nothing to press').toBeTruthy();
  await act(async () => {
    target?.click();
    await flush();
  });
}

function fill(label: string, value: string): void {
  const labelEl = [...dialog()!.querySelectorAll('label')].find((l) => l.textContent === label);
  const input = document.getElementById(labelEl!.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitDialog(): Promise<void> {
  await act(async () => {
    dialog()?.querySelector('form')?.requestSubmit();
    await flush();
  });
}

async function openGlossary(): Promise<void> {
  await press(container.querySelector<HTMLElement>('[data-slot="glossary-row"]'));
  await act(flush);
}

describe('creating a glossary', () => {
  it('opens a dialog from the topbar, creates, opens the new glossary and says so', async () => {
    await mount();
    const topbar = container.querySelector('[data-slot="topbar-actions"]')!;
    await press(button('New glossary', topbar));
    await settle(() => dialog() !== null);
    expect(dialog()?.textContent).toContain('New glossary');

    fill('Name', '  Medical  ');
    await submitDialog();
    await settle(() => dialog() === null);

    expect(api.saveGlossary).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      name: 'Medical',
      description: null,
      // The first supported language, which the dialog starts on.
      sourceLang: LANGUAGE_CODES[0],
    });
    expect(dialog()).toBeNull();
    expect(notify.success).toHaveBeenCalledWith('Glossary “Medical” created');
    expect(crumb()).toBe('Medical');
  });

  it('keeps Create disabled until there is a name', async () => {
    await mount();
    await press(button('New glossary'));
    await settle(() => dialog() !== null);
    expect(button('Create', dialog()!)?.disabled).toBe(true);
  });
});

describe('the open glossary', () => {
  beforeEach(() => {
    store.glossaries = [GLOSSARY];
    store.items = [TERM];
  });

  it('draws the list and the terms on the page ground, with no card', async () => {
    await mount();
    await openGlossary();
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(0);
    expect(container.querySelector('[data-slot="glossary-term"]')?.textContent).toContain('đồ án');
    expect(crumb()).toBe('Thesis defense');
  });

  it('adds a term through the dialog and says so', async () => {
    await mount();
    await openGlossary();
    await press(button('Add term', container));
    await settle(() => dialog() !== null);
    fill('Original', 'phản biện');
    fill('Translation', 'review');
    await submitDialog();
    await settle(() => dialog() === null);

    expect(api.addGlossaryItem).toHaveBeenCalledWith(
      'g-1',
      expect.objectContaining({ original: 'phản biện', translation: 'review' }),
    );
    expect(notify.success).toHaveBeenCalledWith('Added “phản biện”');
    expect(container.textContent).toContain('review');
  });

  it('edits a term by storing the new version, then deleting the old one', async () => {
    await mount();
    await openGlossary();
    await press(container.querySelector<HTMLElement>('button[aria-label="Edit đồ án"]'));
    await settle(() => dialog() !== null);
    expect(dialog()?.textContent).toContain('Edit term');
    fill('Translation', 'capstone project');
    await submitDialog();
    await settle(() => dialog() === null);

    expect(api.addGlossaryItem).toHaveBeenCalledWith(
      'g-1',
      expect.objectContaining({ original: 'đồ án', translation: 'capstone project' }),
    );
    expect(api.deleteGlossaryItem).toHaveBeenCalledWith('g-1', 'item-0');
    expect(api.addGlossaryItem.mock.invocationCallOrder[0]).toBeLessThan(
      api.deleteGlossaryItem.mock.invocationCallOrder[0]!,
    );
    expect(notify.success).toHaveBeenCalledWith('Saved “đồ án”', { id: 'glossary-term-item-0' });
    const terms = [...container.querySelectorAll('[data-slot="glossary-term"]')];
    expect(terms).toHaveLength(1);
    expect(terms[0]?.textContent).toContain('capstone project');
  });

  it('never loses a term: an edit whose delete fails keeps both and offers a retry', async () => {
    store.failDeleteItem = true;
    await mount();
    await openGlossary();
    await press(container.querySelector<HTMLElement>('button[aria-label="Edit đồ án"]'));
    await settle(() => dialog() !== null);
    fill('Translation', 'capstone project');
    await submitDialog();
    await settle(() => dialog() === null);

    expect(notify.error).toHaveBeenCalledWith(
      'The new “đồ án” is saved, but the old version is still listed.',
      { id: 'glossary-term-item-0', retry: anyFunction },
    );
    expect(container.querySelectorAll('[data-slot="glossary-term"]')).toHaveLength(2);

    store.failDeleteItem = false;
    await act(async () => {
      notify.error.mock.calls[0]?.[1]?.retry?.();
      await flush();
    });
    expect(container.querySelectorAll('[data-slot="glossary-term"]')).toHaveLength(1);
  });

  it('deletes a term behind the confirm dialog and says so', async () => {
    await mount();
    await openGlossary();
    const row = container.querySelector<HTMLElement>('[data-slot="glossary-term"]')!;
    await press(row.querySelector<HTMLElement>('button[aria-label="Delete đồ án"]'));
    await settle(() => confirm() !== null);
    expect(api.deleteGlossaryItem).not.toHaveBeenCalled();
    await press(button('Delete', confirm()!));
    await settle(() => confirm() === null);

    expect(api.deleteGlossaryItem).toHaveBeenCalledWith('g-1', 'item-0');
    expect(notify.success).toHaveBeenCalledWith('Deleted “đồ án”');
    expect(container.querySelector('[data-slot="glossary-term"]')).toBeNull();
  });

  it('deletes the glossary behind the confirm dialog, naming what goes with it', async () => {
    await mount();
    await openGlossary();
    const header = container.querySelector('[data-slot="glossary-detail-header"]')!;
    await press(header.querySelector<HTMLElement>('button[aria-label="Delete Thesis defense"]'));
    await settle(() => confirm() !== null);
    expect(confirm()?.textContent).toContain('Every term in it is deleted too');
    await press(button('Delete', confirm()!));
    await settle(() => confirm() === null);

    expect(api.deleteGlossary).toHaveBeenCalledWith('g-1');
    expect(notify.success).toHaveBeenCalledWith('Glossary “Thesis defense” deleted');
    expect(container.querySelector('[data-slot="glossary-empty"]')).not.toBeNull();
  });

  it('turns the glossary off from its switch, with an undo', async () => {
    await mount();
    await openGlossary();
    await press(container.querySelector<HTMLElement>('[role="switch"]'));

    expect(api.patchGlossary).toHaveBeenCalledWith('g-1', { isActive: false });
    expect(notify.success).toHaveBeenCalledWith(
      '“Thesis defense” is no longer used while translating',
      { id: 'glossary-active-g-1', undo: anyFunction },
    );
    await act(async () => {
      notify.success.mock.calls[0]?.[1]?.undo?.();
      await flush();
    });
    expect(api.patchGlossary).toHaveBeenLastCalledWith('g-1', { isActive: true });
  });

  it('says so, with a retry, when the switch cannot be saved', async () => {
    store.failPatch = true;
    await mount();
    await openGlossary();
    await press(container.querySelector<HTMLElement>('[role="switch"]'));

    expect(notify.error).toHaveBeenCalledWith('Could not change “Thesis defense”.', {
      id: 'glossary-active-g-1',
      retry: anyFunction,
    });
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });
});
