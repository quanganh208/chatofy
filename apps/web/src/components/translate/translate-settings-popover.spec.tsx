// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rule the wire cannot enforce: what a running conversation already fixed cannot
 * be offered as if it were still adjustable.
 *
 * `client.session.start` carries these, and `ConversationSession` keeps the options for
 * the whole run with no way to reconfigure them. So a control that stayed live
 * mid-conversation would accept the change, look like it worked, and translate the next
 * turn the old way — nothing throws and nothing logs. `running` reaching `disabled` is
 * the only thing standing between that and the user.
 *
 * Volume is the counter-example in the same test, and it belongs here: it is applied
 * client-side to the gain node, so it must stay live. A change that disabled the whole
 * panel while running would satisfy every other assertion here.
 *
 * **Direction is no longer one of these controls.** It left this popover for the panel
 * headers on `/translate`, which name it permanently instead of hiding it behind a gear;
 * `panel-headers.spec.tsx` holds the same disabled-while-running rule there. What this
 * file still holds is that it did not come back — a settings surface that names the
 * direction as well would be the same fact twice, with the quieter copy winning.
 */

vi.mock('@/hooks/use-voice-catalog', () => ({
  // A backend that published no voices — a real answer, and the one that keeps this
  // spec about `running` rather than about an HTTP call.
  useVoiceCatalog: () => ({ status: 'ready', voices: [] }),
}));

const { TranslateSettingsPopover } = await import('./translate-settings-popover');
const { LocaleProvider } = await import('@/i18n/provider');
const { DEFAULT_TRANSLATE_SETTINGS } = await import('@/lib/translate-settings');

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
});

/** The content is portalled to `document.body`, so assertions read the document. */
function open(running: boolean) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <TranslateSettingsPopover
          settings={DEFAULT_TRANSLATE_SETTINGS}
          running={running}
          onChange={() => {}}
          onVolumeChange={() => {}}
        />
      </LocaleProvider>,
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label]');
  act(() => trigger?.click());
  return trigger;
}

describe('TranslateSettingsPopover', () => {
  it('names its trigger for a screen reader', () => {
    const trigger = open(false);
    expect(trigger?.getAttribute('aria-label')).toBe('Conversation settings');
  });

  it('freezes what the running session already fixed, and only that', () => {
    open(true);

    const speak = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Speak the translation aloud"]',
    );
    expect(speak).not.toBeNull();
    expect(speak?.disabled).toBe(true);

    // Client-side, so it stays live: dragging it mid-conversation must move the gain.
    const volume = document.querySelector<HTMLElement>('[aria-label="Playback volume"]');
    expect(volume).not.toBeNull();
    expect(volume?.getAttribute('data-disabled')).toBeNull();
  });

  it('does not name the direction, which the panel headers already do', () => {
    open(false);

    // Set-once things only. The direction is on the surface now, in two headers
    // that are always visible; repeating it here would put the authoritative
    // statement of "which way is this translating" behind a gear again.
    expect(document.querySelector('button[aria-label^="Swap direction"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Source');
  });

  it('takes its surface from the popover rather than bringing one', () => {
    open(false);

    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    // The panel returned a `Card` while the popover was its only future mount, which
    // would now draw a bordered card inside a bordered popover. Phase 8 mounts the same
    // component on a page and supplies the card there.
    expect(content?.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('leaves the page underneath reachable', () => {
    open(false);

    // Radix marks the rest of the document `aria-hidden` only for a MODAL surface.
    // A popover over a live conversation must not: the transcript is the thing being
    // read while the settings are open.
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });
});
