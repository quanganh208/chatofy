// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { ContextPicker } from './context-picker';

/**
 * The three states that are not "a list of contexts".
 *
 * An empty library renders NOTHING, which is what keeps every screen of the
 * accent budget unchanged for an account that has authored none — and it has to
 * be distinguishable from a library still loading, or the control would appear
 * under the reader's pointer a moment after the page settled.
 *
 * A selection naming a context that no longer exists must read as "None". That is
 * the reconciliation rule `loadTranslateSettings` records for the voice token,
 * applied where the list has resolved.
 */

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

function render(node: React.ReactNode): void {
  act(() => {
    root.render(<LocaleProvider>{node}</LocaleProvider>);
  });
}

const trigger = () => container.querySelector('[data-slot="select-trigger"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ContextPicker', () => {
  it('renders nothing for an empty library', () => {
    render(<ContextPicker contexts={[]} status="ready" value={null} onChange={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing while the list is still loading', () => {
    // An empty list is only an answer once the request that fills it has
    // finished — otherwise the control appears a moment after the page settled.
    render(<ContextPicker contexts={[]} status="loading" value={null} onChange={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('shows the selected context on the trigger', () => {
    render(<ContextPicker contexts={[CONTEXT]} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(trigger()?.textContent).toContain('Thesis defense');
  });

  it('reads a selection that no longer resolves as None', () => {
    render(
      <ContextPicker contexts={[CONTEXT]} status="ready" value="ctx-gone" onChange={vi.fn()} />,
    );
    expect(trigger()?.textContent).toContain(en['web.translate.contextNone']);
  });

  it('spends no accent — the trigger is never accent-filled', () => {
    // The screen's one accent-filled control is Start, and this picker must not
    // become a second one.
    render(<ContextPicker contexts={[CONTEXT]} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(trigger()?.classList.contains('bg-primary')).toBe(false);
  });

  it('is disabled while a conversation runs, and says why', () => {
    render(
      <ContextPicker
        contexts={[CONTEXT]}
        status="ready"
        value="ctx-1"
        running
        onChange={vi.fn()}
      />,
    );
    expect(trigger()?.hasAttribute('disabled')).toBe(true);
    // Words explain a refusal, never a function: the hint exists only while the
    // control is actually refusing.
    expect(container.textContent).toContain(en['web.translate.contextLocked']);
  });

  it('says nothing about being locked when it is not', () => {
    render(<ContextPicker contexts={[CONTEXT]} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(container.textContent).not.toContain(en['web.translate.contextLocked']);
  });
});
