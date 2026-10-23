// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaders } from './panel-headers';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The language pair, said permanently instead of hidden behind a gear.
 *
 * The swap must go dead while a conversation runs: `client.session.start` carries
 * the pair and `ConversationSession` holds it for the whole run, so a live
 * swap would accept the press, look like it worked, and translate the next turn
 * the old way — nothing thrown, nothing logged.
 *
 * The voice control is a SLOT, and the second half of that rule is that this
 * component must not extend `running` to it. Volume is live mid-conversation, so
 * the thing in the slot is the only way to reach a working control while somebody
 * is talking; a header that disabled its own slot would hide it behind the rule
 * that applies to the swap and to nothing else here.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  props: Partial<Parameters<typeof PanelHeaders>[0]> = {},
  locale: 'en' | 'vi' = 'en',
) {
  const onSwap = vi.fn();
  const onLanguagePair = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider locale={locale}>
        <PanelHeaders
          languagePair={{ source: 'vi', target: 'en' }}
          running={false}
          onSwap={onSwap}
          onLanguagePair={onLanguagePair}
          voiceControl={<button type="button">voice slot</button>}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { onSwap, onLanguagePair };
}

/** The two language pickers, source first. */
function pickers(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')];
}

/**
 * The names a picker offers, read off its open list. Opened from the keyboard,
 * which Radix answers without the pointer-capture APIs happy-dom lacks.
 */
function offered(picker: HTMLButtonElement): string[] {
  act(() => {
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const names = [...document.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent ?? '',
  );
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  return names;
}

function swap(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Swap languages"]');
}

function slot(): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('voice slot'),
    ) ?? null
  );
}

describe('PanelHeaders', () => {
  it('names both sides in words, never as codes', () => {
    render();
    expect(container.textContent).toContain('Source');
    expect(container.textContent).toContain('Translation');
    // In the interface locale (English here): the same name history rows and
    // glossary columns use, not the language's own name for itself.
    expect(container.textContent).toContain('Vietnamese');
    expect(container.textContent).toContain('English');
    // The codes are an implementation detail of the wire and have no business on
    // a screen — the rule the language control was rewritten to hold.
    expect(container.textContent).not.toMatch(/\b(vi|en)\b/);
  });

  it('names the languages in the Vietnamese interface in Vietnamese', () => {
    render({ languagePair: { source: 'zh', target: 'vi' } }, 'vi');
    expect(pickers().map((picker) => picker.textContent)).toEqual(['Tiếng Trung', 'Tiếng Việt']);
    expect(container.textContent).not.toContain('中文');
  });

  it('stacks the two sides, identically at every width', () => {
    render();
    // This carried a two-column branch nothing ever asked for — the arrangement
    // with side-by-side panes gives each pane its own `PanelHeader` instead, so
    // the only layout that ever shipped from here is the stacked pair over one
    // stream. With the branch gone there is no breakpoint fork left at all, and
    // the rule under the source side is what separates the two at every width.
    expect(container.innerHTML).not.toMatch(/\bsm:/);

    const [source, target] = pickers().map((picker) => picker.parentElement?.parentElement);
    expect(source?.className).toContain('border-b');
    expect(target?.className ?? '').not.toContain('border-b');
  });

  it('follows the pair rather than assuming one', () => {
    render({ languagePair: { source: 'en', target: 'vi' } });
    const [source, translation] = pickers().map((picker) => picker.textContent);
    expect(source).toBe('English');
    expect(translation).toBe('Vietnamese');
  });

  it('picks a language per side, and keeps the one-press swap', () => {
    const { onSwap } = render();
    // With three languages each side is a real choice, so each is a picker,
    // named for its side. The swap stays: reversing the pair between turns is
    // the common action, and it is one press instead of two selects.
    expect(pickers().map((picker) => picker.getAttribute('aria-label'))).toEqual([
      'Source',
      'Translation',
    ]);
    expect(swap()).toBeTruthy();
    expect(slot()).toBeTruthy();
    act(() => swap()?.click());
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it('spends no accent: the pickers are fields and the swap is outline', () => {
    render();
    expect(container.querySelector('.bg-primary')).toBeNull();
  });

  it('goes dead while a conversation is running, without going away', () => {
    render({ running: true });
    expect(swap()?.disabled).toBe(true);
    expect(pickers().every((picker) => picker.disabled)).toBe(true);
    // Disabled, not hidden: which way this is translating is exactly what a
    // reader still wants to see while they are talking.
    expect(container.textContent).toContain('Vietnamese');
    expect(container.textContent).toContain('English');
  });

  it('says which way the swap would go, not just "swap"', () => {
    render();
    // A bare verb with no object is unusable from a screen reader: "swap" what,
    // into what. The interpolated name is why the key takes two arguments.
    expect(swap()?.getAttribute('aria-label')).toBe(
      'Swap languages — translate English into Vietnamese',
    );
  });

  it('renders whatever voice control it is handed, in the target header', () => {
    // A slot rather than props: what goes here reads and writes the whole settings
    // object, and this component is about the two languages and the swap.
    render();
    expect(slot()).toBeTruthy();
  });

  it('leaves the voice control alone while running', () => {
    // The swap beside it goes dead because the pair is fixed for the run.
    // The voice control must not follow it by default — volume is live, so its
    // own popover decides, and this header has no business overriding that.
    render({ running: true });
    expect(swap()?.disabled).toBe(true);
    expect(slot()?.disabled).toBe(false);
  });

  it('leads the source picker with Auto-detect, and only the source picker', () => {
    render();
    const [source, target] = pickers();
    expect(offered(source!)).toEqual(['Auto-detect', 'Vietnamese', 'English', 'Chinese']);
    expect(offered(target!)).toEqual(['Vietnamese', 'English', 'Chinese']);
  });

  it('offers no Auto-detect into a language a turn cannot be recognised in', () => {
    // Chinese misses the identification bar, so a turn said in it could not be
    // kept as transcript-only — the one thing Auto-detect promises about the
    // translation language itself.
    render({ languagePair: { source: 'vi', target: 'zh' } });
    expect(offered(pickers()[0]!)).toEqual(['Vietnamese', 'English', 'Chinese']);
  });

  it('shows Auto-detect as the source, with no swap to offer', () => {
    render({ languagePair: { source: 'detect', target: 'en' } });
    expect(pickers()[0]?.textContent).toBe('Auto-detect');
    expect(swap()?.disabled).toBe(true);
    // Not "translate English into Auto-detect": that names a direction that
    // does not exist.
    expect(swap()?.getAttribute('aria-label')).toBe(
      'Swap languages — not available with Auto-detect',
    );
  });

  it('drops Auto-detect when the translation picked rules it out', () => {
    const { onLanguagePair } = render({ languagePair: { source: 'detect', target: 'en' } });
    const target = pickers()[1]!;
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const chinese = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent === 'Chinese',
    );
    act(() => {
      chinese?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onLanguagePair).toHaveBeenCalledWith({ source: 'vi', target: 'zh' });
  });

  it('says nothing about the mode until a turn has answered', () => {
    render();
    expect(container.querySelector('[data-language-mode]')).toBeNull();
  });

  it('says which way the server is running the newest turn, as words, not a switch', () => {
    render({ mode: 'two-way' });
    expect(container.textContent).toContain('Both ways');
    render({ mode: 'declared' });
    expect(container.textContent).toContain('One way');
    render({ mode: 'detect' });
    expect(container.textContent).toContain('One way');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('.bg-primary')).toBeNull();
  });
});
