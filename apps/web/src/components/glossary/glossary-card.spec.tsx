// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const term = {
  id: 't1',
  vi: 'nhồi máu cơ tim',
  en: 'myocardial infarction',
  keepVerbatim: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const list = vi.fn(() => Promise.resolve({ terms: [term] }));
vi.mock('@/clients/api-client', () => ({
  listGlossary: () => list(),
  createGlossaryTerm: vi.fn(),
  updateGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
  importGlossary: vi.fn(),
}));

const { GlossaryCard } = await import('@/components/glossary/glossary-card');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  list.mockReturnValue(Promise.resolve({ terms: [term] }));
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <GlossaryCard />
      </LocaleProvider>,
    );
    // Flush the load effect and the state update it schedules.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the glossary card', () => {
  it('renders the add form and a loaded term pair', async () => {
    await render();
    const text = container.textContent ?? '';
    // The add control is present…
    expect(text).toContain('Add term');
    // …and the loaded pair shows both spellings.
    expect(text).toContain('nhồi máu cơ tim');
    expect(text).toContain('myocardial infarction');
  });

  it('shows the empty state when the glossary has no terms', async () => {
    list.mockReturnValue(Promise.resolve({ terms: [] }));
    await render();
    expect(container.textContent).toContain('No terms yet');
  });

  it('marks a keep-verbatim term with its badge', async () => {
    list.mockReturnValue(
      Promise.resolve({ terms: [{ ...term, vi: 'Zalo', en: 'Zalo', keepVerbatim: true }] }),
    );
    await render();
    expect(container.textContent).toContain('verbatim');
  });
});
