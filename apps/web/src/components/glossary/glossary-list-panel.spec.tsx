// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';
import { GlossaryListPanel } from './glossary-list-panel';

/**
 * When the list cannot load, the user needs two things the panel did not give: the
 * message announced to a screen reader, and a way to try again without reloading the page.
 * History already had both; the glossary only printed a red sentence.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(onRetry = vi.fn()) {
  act(() => {
    root.render(
      <LocaleProvider locale="en">
        <GlossaryListPanel
          glossaries={[]}
          status="failed"
          selectedId={null}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onRetry={onRetry}
        />
      </LocaleProvider>,
    );
  });
  return onRetry;
}

describe('GlossaryListPanel empty list', () => {
  it('matches History: an icon, a bold title, then one sentence on what it is for', () => {
    act(() => {
      root.render(
        <LocaleProvider locale="en">
          <GlossaryListPanel
            glossaries={[]}
            status="ready"
            selectedId={null}
            onSelect={vi.fn()}
            onSave={vi.fn()}
            onToggleActive={vi.fn()}
            onDelete={vi.fn()}
            onRetry={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    const block = container.querySelector('[data-slot="glossary-empty"]');
    expect(block?.querySelector('svg')).not.toBeNull();
    expect(block?.querySelector('p.font-semibold')?.textContent).toBe('No glossaries yet');
    expect(block?.textContent).toContain('Press New to make one.');
  });
});

describe('GlossaryListPanel when loading failed', () => {
  it('announces the failure to assistive technology', () => {
    render();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not load your glossaries.');
  });

  it('offers a retry that calls onRetry', () => {
    const onRetry = render();
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    );
    expect(button, 'no Try again button').toBeTruthy();
    act(() => button!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
