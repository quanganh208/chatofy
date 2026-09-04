// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaders } from './panel-headers';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The direction, said permanently instead of hidden behind a gear.
 *
 * Both controls here must go dead while a conversation runs, and for the same
 * reason: `client.session.start` carries the direction and the speak-aloud flag,
 * and `ConversationSession` holds both for the whole run. A live swap would
 * accept the press, look like it worked, and translate the next turn the old way
 * — nothing thrown, nothing logged. Speak-aloud is stronger still: the server
 * skips synthesis entirely when it is off, decided once at start.
 *
 * The speaker SHIPPED as an inert mark on that reasoning, and owner review was
 * somebody pressing it over and over. `disabled` is a state a control is allowed
 * to be in; unpressable-and-not-a-button is not. So the assertions below hold it
 * to being a real toggle that is honestly disabled, exactly like the swap beside
 * it — and to saying its state in words, because the difference between hearing
 * the translation and not cannot rest on a 16px slash through a glyph.
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
  const onToggleVoice = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <PanelHeaders
          direction="vi_to_en"
          running={false}
          voiceOutput
          columns
          onSwap={onSwap}
          onToggleVoice={onToggleVoice}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { onSwap, onToggleVoice };
}

function swap(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Swap direction"]');
}

function speak(): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Speak translation'),
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
    expect(speak()).toBeTruthy();
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

  it('says whether the translation is spoken, in words rather than in a glyph', () => {
    render({ voiceOutput: true });
    expect(speak()?.textContent).toContain('Speak translation: on');

    render({ voiceOutput: false });
    expect(speak()?.textContent).toContain('Speak translation: off');
  });

  it('lets playback be changed, because it looks like it can be', () => {
    // This shipped as an inert span with a title, and owner review was somebody
    // pressing it repeatedly and getting nothing. A speaker glyph in the corner
    // of a panel is a button everywhere else; the fix is to be one.
    const { onToggleVoice } = render({ voiceOutput: true });

    expect(speak()?.getAttribute('aria-pressed')).toBe('true');
    act(() => speak()?.click());
    expect(onToggleVoice).toHaveBeenCalledTimes(1);

    render({ voiceOutput: false });
    expect(speak()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('refuses mid-conversation and says what to do instead', () => {
    // The server decides once, at session start, whether to synthesize at all.
    // Disabled is honest here; a live toggle would accept the press and change
    // nothing, which is the failure the swap beside it already avoids.
    const { onToggleVoice } = render({ running: true });

    expect(speak()?.disabled).toBe(true);
    expect(speak()?.getAttribute('title')).toBe('Set this before the conversation starts');
    act(() => speak()?.click());
    expect(onToggleVoice).not.toHaveBeenCalled();
  });
});
