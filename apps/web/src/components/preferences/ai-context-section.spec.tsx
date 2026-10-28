// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';
import { CONTEXT_LIMITS } from '@chatofy/types';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { AiContextSection } from './ai-context-section';

/**
 * What the editor sends, and what it refuses to send.
 *
 * The glossary is the interesting half. A pair is TWO correlated strings, and the
 * editor always carries a trailing empty row so there is somewhere to type — so a
 * save that did not drop half-filled rows would post a rendering of nothing on
 * every single write, and the contract would refuse the whole context for it.
 *
 * The ceiling is asserted on the WORDS as much as on the control: a disabled
 * button with no explanation is a dead end, and the rule this repo holds is that
 * words explain a refusal.
 */

const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const saveTranslationContext = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
const deleteTranslationContext = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
const listGlossaries = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listTranslationContexts: () => listTranslationContexts(),
  saveTranslationContext: (...args: unknown[]) => saveTranslationContext(...args),
  // Forwards its argument rather than discarding it: which row a confirmed
  // delete actually removes is the thing worth pinning, and a mock that drops
  // the id can only ever count the calls.
  deleteTranslationContext: (...args: unknown[]) => deleteTranslationContext(...args),
  listGlossaries: () => listGlossaries(),
}));

const context = (over: Partial<TranslationContext> = {}): TranslationContext => ({
  id: 'ctx-1',
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  glossaryId: null,
  linkedGlossaryId: null,
  linkedGlossaryName: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AiContextSection />
      </LocaleProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

const buttonSaying = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );

async function click(element: HTMLElement | undefined): Promise<void> {
  expect(element, 'the control is not on screen').toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
}

/** Type into a field the way React's controlled inputs require. */
async function type(selector: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(field, `nothing matches ${selector}`).not.toBeNull();
  // The native setter, because React installs its own on the element and writing
  // `field.value` directly leaves React's internal value tracker thinking nothing
  // changed — so the `input` event below is swallowed and the state never moves.
  const descriptor = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  );
  const setValue = (target: HTMLElement, next: string) => descriptor?.set?.call(target, next);

  await act(async () => {
    if (field) setValue(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listTranslationContexts.mockResolvedValue({ contexts: [] });
  saveTranslationContext.mockResolvedValue({ context: context() });
  deleteTranslationContext.mockResolvedValue(undefined);
  listGlossaries.mockResolvedValue({ glossaries: [] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('AiContextSection', () => {
  it('says the library is empty rather than showing an empty list', async () => {
    await mount();
    expect(container.textContent).toContain(en['web.preferences.aiContext.empty']);
  });

  it('lists what is stored', async () => {
    listTranslationContexts.mockResolvedValue({
      contexts: [context(), context({ id: 'ctx-2', name: 'Hotel check-in' })],
    });
    await mount();
    expect(container.textContent).toContain('Thesis defense');
    expect(container.textContent).toContain('Hotel check-in');
  });

  it('opens the editor INLINE, portalling nothing', async () => {
    // A `Dialog` would portal into `document.body`, which the surface counter
    // queries — the screen already has its two surfaces and a third fails the
    // accent-budget gate.
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.new']));

    expect(container.querySelector('[data-slot="textarea"]')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('splits keywords one per line and drops the blanks', async () => {
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.new']));

    await type('#ai-context-name', 'Thesis defense');
    await type('#ai-context-keywords', 'VinFast\n\n  Nguyễn  \n');
    await click(buttonSaying(en['web.preferences.aiContext.save']));

    const [, body] = saveTranslationContext.mock.calls[0] as [string, { hotwords: string[] }];
    expect(body.hotwords).toEqual(['VinFast', 'Nguyễn']);
  });

  it('keeps what was typed when the save fails, and says so', async () => {
    // What the user typed is the expensive thing here; a failed write must not be
    // a way to lose it.
    saveTranslationContext.mockRejectedValue(new Error('offline'));
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.new']));
    await type('#ai-context-name', 'Thesis defense');
    await click(buttonSaying(en['web.preferences.aiContext.save']));

    expect(container.textContent).toContain(en['web.preferences.aiContext.saveFailed']);
    expect(container.querySelector<HTMLInputElement>('#ai-context-name')?.value).toBe(
      'Thesis defense',
    );
  });

  it('refuses a new context at the ceiling, and explains the refusal', async () => {
    listTranslationContexts.mockResolvedValue({
      contexts: Array.from({ length: CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER }, (_, i) =>
        context({ id: `ctx-${i}`, name: `Context ${i}` }),
      ),
    });
    await mount();

    const create = buttonSaying(en['web.preferences.aiContext.new']);
    expect(create?.hasAttribute('disabled')).toBe(true);
    expect(container.textContent).toContain(en['web.preferences.aiContext.limitReached']);
  });

  it('still lets an existing context be edited at the ceiling', async () => {
    // Otherwise a full library is permanently uneditable: the user could neither
    // add to it nor fix what is in it.
    listTranslationContexts.mockResolvedValue({
      contexts: Array.from({ length: CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER }, (_, i) =>
        context({ id: `ctx-${i}`, name: `Context ${i}` }),
      ),
    });
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.edit']));

    await click(buttonSaying(en['web.preferences.aiContext.save']));
    expect(saveTranslationContext).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load rather than showing an empty library', async () => {
    listTranslationContexts.mockRejectedValue(new Error('offline'));
    await mount();
    expect(container.textContent).toContain(en['web.preferences.aiContext.loadFailed']);
  });

  it('requires a second press before a context is deleted', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });
    await mount();

    await click(buttonSaying(en['web.preferences.aiContext.delete']));
    expect(deleteTranslationContext).not.toHaveBeenCalled();
    // The row is still here: the first press only asked, it did not act.
    expect(container.textContent).toContain('Thesis defense');

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === en['web.preferences.aiContext.delete'],
    );
    await click(confirm);
    expect(deleteTranslationContext).toHaveBeenCalledTimes(1);
  });

  it('deletes the row that was confirmed, not another one', async () => {
    // Each row draws its own pair of controls, so the id a confirmed press
    // carries is the thing worth pinning: a count alone cannot tell the right
    // row from its neighbour.
    listTranslationContexts.mockResolvedValue({
      contexts: [
        context({ id: 'ctx-1', name: 'Thesis defense' }),
        context({ id: 'ctx-2', name: 'Sprint planning' }),
      ],
    });
    await mount();

    const label = `${en['web.preferences.aiContext.delete']} Sprint planning`;
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === label,
    );
    await click(trigger);

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) =>
        button.getAttribute('aria-label') === label &&
        button.textContent === en['web.preferences.aiContext.delete'],
    );
    await click(confirm);

    expect(deleteTranslationContext).toHaveBeenCalledWith('ctx-2');
  });

  it('puts keyboard focus inside the step it just opened, and back when dismissed', async () => {
    // React unmounts the button that was pressed, and the browser drops focus to
    // `<body>` when it goes — the top of the page, above every other section.
    // Cancel rather than the destructive button, so one held Enter cannot take
    // both steps.
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });
    await mount();

    await click(buttonSaying(en['web.preferences.aiContext.delete']));
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === en['web.preferences.aiContext.cancel'],
    );
    expect(document.activeElement).toBe(cancel);

    await click(cancel);
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === en['web.preferences.aiContext.delete'],
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('reports a failed delete rather than losing the row silently', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [context()] });
    deleteTranslationContext.mockRejectedValue(new Error('offline'));
    await mount();

    await click(buttonSaying(en['web.preferences.aiContext.delete']));
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === en['web.preferences.aiContext.delete'],
    );
    await click(confirm);

    expect(container.textContent).toContain(en['web.preferences.aiContext.deleteFailed']);
    expect(container.textContent).toContain('Thesis defense');
  });

  it('refuses to save a keyword line the contract would reject, and names the rule', async () => {
    const keywordTooLong = en['web.preferences.aiContext.keywordTooLong'].replace(
      '{max}',
      String(CONTEXT_LIMITS.MAX_HOTWORD_CHARS),
    );
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.new']));

    await type('#ai-context-name', 'Invoices');
    await type('#ai-context-keywords', 'x'.repeat(70));

    expect(container.textContent).toContain(keywordTooLong);
    expect(buttonSaying(en['web.preferences.aiContext.save'])?.hasAttribute('disabled')).toBe(true);

    await click(buttonSaying(en['web.preferences.aiContext.save']));
    expect(saveTranslationContext).not.toHaveBeenCalled();
  });

  it('refuses to silently drop keywords past the ceiling', async () => {
    // The editor's own rule for the glossary — a refusal on screen rather than
    // a save that quietly kept only the first 48 — applied here too.
    const total = CONTEXT_LIMITS.MAX_HOTWORDS + 1;
    const keywordsTooMany = en['web.preferences.aiContext.keywordsTooMany']
      .replace('{count}', String(total))
      .replace('{max}', String(CONTEXT_LIMITS.MAX_HOTWORDS));
    await mount();
    await click(buttonSaying(en['web.preferences.aiContext.new']));

    await type('#ai-context-name', 'Invoices');
    await type(
      '#ai-context-keywords',
      Array.from({ length: total }, (_, i) => `term-${i}`).join('\n'),
    );

    expect(container.textContent).toContain(keywordsTooMany);
    expect(buttonSaying(en['web.preferences.aiContext.save'])?.hasAttribute('disabled')).toBe(true);

    await click(buttonSaying(en['web.preferences.aiContext.save']));
    expect(saveTranslationContext).not.toHaveBeenCalled();
  });
});
