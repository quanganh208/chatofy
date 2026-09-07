// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaders } from './panel-headers';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The direction, said permanently instead of hidden behind a gear.
 *
 * The swap must go dead while a conversation runs: `client.session.start` carries
 * the direction and `ConversationSession` holds it for the whole run, so a live
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

function render(props: Partial<Parameters<typeof PanelHeaders>[0]> = {}) {
  const onSwap = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <PanelHeaders
          direction="vi_to_en"
          running={false}
          onSwap={onSwap}
          voiceControl={<button type="button">voice slot</button>}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { onSwap };
}

function swap(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Swap direction"]');
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
    // Autonyms, in both locales: a language is named the way its own speakers
    // name it, which is the rule the locale switcher already follows.
    expect(container.textContent).toContain('Tiếng Việt');
    expect(container.textContent).toContain('English');
    // The codes are an implementation detail of the wire and have no business on
    // a screen — this is the rule `DirectionToggle` was rewritten to hold.
    expect(container.textContent).not.toMatch(/\bvi_to_en\b/);
  });

  it('stacks the two sides, identically at every width', () => {
    render();
    // This carried a two-column branch nothing ever asked for — the arrangement
    // with side-by-side panes gives each pane its own `PanelHeader` instead, so
    // the only layout that ever shipped from here is the stacked pair over one
    // stream. With the branch gone there is no breakpoint fork left at all, and
    // the rule under the source side is what separates the two at every width.
    expect(container.innerHTML).not.toMatch(/\bsm:/);

    const [source, target] = [...container.querySelectorAll('span.text-body')].map(
      (name) => name.parentElement?.parentElement,
    );
    expect(source?.className).toContain('border-b');
    expect(target?.className ?? '').not.toContain('border-b');
  });

  it('follows the direction rather than assuming one', () => {
    render({ direction: 'en_to_vi' });
    const [source, translation] = [...container.querySelectorAll('.text-body')].map(
      (el) => el.textContent,
    );
    expect(source).toBe('English');
    expect(translation).toBe('Tiếng Việt');
  });

  it('offers no way to pick a language, only to swap', () => {
    const { onSwap } = render();
    // The languages are readouts. A picker per side would be a third and fourth
    // way to make the same change — with `vi`/`en` the whole enum, choosing the
    // other value in either picker IS the swap.
    expect(container.querySelectorAll('button').length).toBe(2);
    expect(swap()).toBeTruthy();
    expect(slot()).toBeTruthy();
    act(() => swap()?.click());
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it('goes dead while a conversation is running, without going away', () => {
    render({ running: true });
    expect(swap()?.disabled).toBe(true);
    // Disabled, not hidden: which way this is translating is exactly what a
    // reader still wants to see while they are talking.
    expect(container.textContent).toContain('Tiếng Việt');
    expect(container.textContent).toContain('English');
  });

  it('says which way the swap would go, not just "swap"', () => {
    render();
    // A bare verb with no object is unusable from a screen reader: "swap" what,
    // into what. The interpolated name is why the key takes two arguments.
    expect(swap()?.getAttribute('aria-label')).toBe(
      'Swap direction — translate English into Tiếng Việt',
    );
  });

  it('renders whatever voice control it is handed, in the target header', () => {
    // A slot rather than props: what goes here reads and writes the whole settings
    // object, and this component is about the two languages and the swap.
    render();
    expect(slot()).toBeTruthy();
  });

  it('leaves the voice control alone while running', () => {
    // The swap beside it goes dead because the direction is fixed for the run.
    // The voice control must not follow it by default — volume is live, so its
    // own popover decides, and this header has no business overriding that.
    render({ running: true });
    expect(swap()?.disabled).toBe(true);
    expect(slot()?.disabled).toBe(false);
  });
});
