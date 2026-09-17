// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { ConversationDefaultsSection } from './conversation-defaults-section';

/**
 * The AI Context row inside the defaults panel: absent, not empty, and never
 * labelled twice.
 *
 * `SettingsSectionRow` draws its label and border-b unconditionally — it has no
 * idea whether the child it wraps rendered anything. `ContextPicker` renders
 * nothing at all for an empty, loading, or failed list, which used to leave a
 * labelled row over an empty cell on every account that had authored nothing
 * yet. This file asserts the row itself is gone in that case, and that once a
 * context exists, "AI Context" appears on screen exactly once rather than once
 * from the row and once from the picker underneath it.
 */

const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listVoices = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listTranslationContexts: () => listTranslationContexts(),
  listVoices: () => listVoices(),
}));

const CONTEXT: TranslationContext = {
  id: 'ctx-1',
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <LocaleProvider>
        <ConversationDefaultsSection />
      </LocaleProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  localStorage.clear();
  listVoices.mockResolvedValue({ voices: [] });
  listTranslationContexts.mockResolvedValue({ contexts: [] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('ConversationDefaultsSection — the AI Context row', () => {
  it('is absent for an account that has authored no contexts', async () => {
    await mount();
    // Not merely an empty picker: the LABEL and the ROW must both be gone, or
    // an account with nothing saved sees "AI Context" over nothing to pick.
    expect(container.textContent).not.toContain(en['web.translate.context']);
  });

  it('is absent while the list is still loading', async () => {
    listTranslationContexts.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(container.textContent).not.toContain(en['web.translate.context']);
  });

  it('is absent when the list failed to load', async () => {
    listTranslationContexts.mockRejectedValue(new Error('offline'));
    await mount();
    expect(container.textContent).not.toContain(en['web.translate.context']);
  });

  it('draws the name visibly exactly once once a context exists', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [CONTEXT] });
    await mount();

    // Both the row's own label and the picker's `sr-only` one carry this exact
    // text — `textContent` sees both regardless of the CSS that hides the
    // second — so the count that matters is how many are actually SEEN.
    const labels = Array.from(container.querySelectorAll('span')).filter(
      (span) => span.textContent === en['web.translate.context'],
    );
    const visible = labels.filter((span) => !span.className.includes('sr-only'));
    expect(visible.length).toBe(1);
    // The picker's own label is still in the DOM, `sr-only`, so the trigger
    // below keeps an accessible name even where a sighted reader already has
    // one from the row.
    expect(labels.length).toBe(2);
    expect(container.querySelector('[data-slot="select-trigger"]')).not.toBeNull();
  });
});
