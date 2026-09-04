// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaders } from './panel-headers';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The direction, said permanently instead of hidden behind a gear.
 *
 * Two things here are load-bearing beyond the layout. The swap must go dead while
 * a conversation runs — `client.session.start` carries the direction and
 * `ConversationSession` holds it for the whole run, so a live swap would accept
 * the press, look like it worked, and translate the next turn the old way, with
 * nothing thrown and nothing logged. And the speaker mark must not be a control:
 * speak-aloud is fixed for the same reason, so a button there would be dead for
 * the length of every conversation and read as broken.
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
          voiceOutput
          columns
          onSwap={onSwap}
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

  it('follows the direction rather than assuming one', () => {
    render({ direction: 'en_to_vi' });
    const [source, translation] = [...container.querySelectorAll('.text-body')].map(
      (el) => el.textContent,
    );
    expect(source).toBe('English');
    expect(translation).toBe('Tiếng Việt');
  });

  it('offers exactly one control, and it swaps', () => {
    const { onSwap } = render();
    // Two readouts and one button. A picker per side would be a third and fourth
    // way to make the same change, on a screen whose job is to be unambiguous.
    expect(container.querySelectorAll('button').length).toBe(1);
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

  it('reports playback as a mark, in words, and not as a button', () => {
    render({ voiceOutput: true });
    expect(container.textContent).toContain('Speak translation: on');

    render({ voiceOutput: false });
    expect(container.textContent).toContain('Speak translation: off');
    // Still one button — the speaker mark did not become a second one. The
    // control lives in the gear, where it can be disabled honestly.
    expect(container.querySelectorAll('button').length).toBe(1);
  });
});
