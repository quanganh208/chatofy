// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import type { ContextGroup } from '@/hooks/use-available-translation-contexts';
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
  glossaryId: null,
  linkedGlossaryId: null,
  linkedGlossaryName: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
};

/** One unlabelled personal group: what a reader in no team gets. */
const FLAT: ContextGroup[] = [{ key: 'personal', label: null, contexts: [CONTEXT] }];

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
    render(<ContextPicker groups={[]} status="ready" value={null} onChange={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing while the list is still loading', () => {
    // An empty list is only an answer once the request that fills it has
    // finished — otherwise the control appears a moment after the page settled.
    render(<ContextPicker groups={[]} status="loading" value={null} onChange={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('shows the selected context on the trigger', () => {
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(trigger()?.textContent).toContain('Thesis defense');
  });

  it('reads a selection that no longer resolves as None', () => {
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-gone" onChange={vi.fn()} />);
    expect(trigger()?.textContent).toContain(en['web.translate.contextNone']);
  });

  it('spends no accent — the trigger is never accent-filled', () => {
    // The screen's one accent-filled control is Start, and this picker must not
    // become a second one.
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(trigger()?.classList.contains('bg-primary')).toBe(false);
  });

  it('is disabled while a conversation runs, and says why', () => {
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-1" running onChange={vi.fn()} />);
    expect(trigger()?.hasAttribute('disabled')).toBe(true);
    // Words explain a refusal, never a function: the hint exists only while the
    // control is actually refusing.
    expect(container.textContent).toContain(en['web.translate.contextLocked']);
  });

  it('says nothing about being locked when it is not', () => {
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-1" onChange={vi.fn()} />);
    expect(container.textContent).not.toContain(en['web.translate.contextLocked']);
  });

  it('hides its own label visually when the caller already draws one', () => {
    // `conversation-defaults-section.tsx` wraps this in a row whose own label
    // reads "AI Context" too — without this, the name was on screen twice.
    render(
      <ContextPicker
        groups={FLAT}
        status="ready"
        value="ctx-1"
        showLabel={false}
        onChange={vi.fn()}
      />,
    );
    const label = container.querySelector('span');
    // Still in the DOM and still the target of `aria-labelledby` below — an
    // assistive reader needs a name for the control even where a sighted one
    // already has it from the row.
    expect(label?.textContent).toBe(en['web.translate.context']);
    expect(label?.className).toContain('sr-only');
    expect(trigger()?.getAttribute('aria-labelledby')).toBe(label?.id);
  });

  it('draws its own label by default', () => {
    render(<ContextPicker groups={FLAT} status="ready" value="ctx-1" onChange={vi.fn()} />);
    const label = container.querySelector('span');
    expect(label?.className).not.toContain('sr-only');
  });
});

/** Why the picker is fixed mid-conversation: said by default, left to a host that says it once. */
describe('ContextPicker — the reason it is fixed', () => {
  const pick = (lockNote?: boolean) => (
    <ContextPicker
      groups={FLAT}
      status="ready"
      value="ctx-1"
      running
      lockNote={lockNote}
      onChange={vi.fn()}
    />
  );

  it('is said while running by default', () => {
    render(pick());
    expect(container.textContent).toContain(en['web.translate.contextLocked']);
  });

  it('is left to the host when it turns the note off, the picker still fixed', () => {
    render(pick(false));
    expect(container.textContent).not.toContain(en['web.translate.contextLocked']);
    expect((trigger() as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});

/** A reader in a team picks from labelled groups, and a team selection resolves. */
describe('ContextPicker — grouped by scope', () => {
  const TEAM_CONTEXT: TranslationContext = {
    ...CONTEXT,
    id: 'ctx-team',
    name: 'Cardiology rounds',
  };
  const GROUPED: ContextGroup[] = [
    { key: 'personal', label: 'Personal', contexts: [CONTEXT] },
    { key: 'team-1', label: 'Ward team', contexts: [TEAM_CONTEXT] },
  ];

  it('shows a team context as the selection', () => {
    render(<ContextPicker groups={GROUPED} status="ready" value="ctx-team" onChange={vi.fn()} />);
    expect(trigger()?.textContent).toBe('Cardiology rounds');
  });

  it('labels each group when open', () => {
    render(<ContextPicker groups={GROUPED} status="ready" value={null} onChange={vi.fn()} />);
    act(() => {
      trigger()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      );
    });
    const labels = [...document.querySelectorAll('[data-slot="select-label"]')];
    expect(labels.map((label) => label.textContent)).toEqual(['Personal', 'Ward team']);
  });
});
