// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rule the wire cannot enforce: what a running conversation already fixed
 * cannot be offered as if it were still adjustable.
 *
 * `client.session.start` carries these, and `ConversationSession` keeps the
 * options for the whole run with no way to reconfigure them. A control that
 * stayed live mid-conversation would accept the change, look like it worked, and
 * translate the next turn the old way — nothing throws and nothing logs.
 * `running` reaching `disabled` is the only thing between that and the user.
 *
 * Volume is the counter-example in the same file, and it belongs here: it is
 * applied client-side to the gain node, so it must stay live. A change that
 * disabled the whole popover while running would satisfy every other assertion.
 *
 * And the trigger itself must never be disabled, for exactly that reason — it is
 * the only way to reach the one audio control that still works mid-conversation.
 */

vi.mock('@/hooks/use-voice-catalog', () => ({
  // A backend that published no voices — a real answer, and the one that keeps
  // this spec about `running` rather than about an HTTP call.
  useVoiceCatalog: () => ({ status: 'ready', voices: [] }),
}));

const { VoiceSettingsPopover } = await import('./voice-settings-popover');
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

function render(running: boolean, voiceOutput = true) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <VoiceSettingsPopover
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, voiceOutput }}
          running={running}
          onChange={() => {}}
          onVolumeChange={() => {}}
        />
      </LocaleProvider>,
    );
  });
  return container.querySelector<HTMLButtonElement>('button[aria-label]');
}

function open(running: boolean, voiceOutput = true) {
  const trigger = render(running, voiceOutput);
  act(() => trigger?.click());
  return trigger;
}

describe('VoiceSettingsPopover', () => {
  it('says whether the translation is spoken without being opened', () => {
    // The reason the inert speaker mark existed at all, and the reason it was
    // worth keeping when it became a control: "why am I not hearing anything"
    // has to be answerable from the closed state.
    expect(render(false, true)?.textContent).toContain('Speak translation: on');
    act(() => root?.unmount());
    expect(render(false, false)?.textContent).toContain('Speak translation: off');
  });

  it('stays reachable mid-conversation, because volume still is', () => {
    const trigger = render(true);
    expect(trigger?.disabled).toBe(false);
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

  it('says why the switch will not move rather than only refusing', () => {
    open(true);
    expect(document.body.textContent).toContain('Set this before the conversation starts');
  });

  it('holds nothing about the page layout', () => {
    open(false);
    expect(document.body.textContent).not.toContain('Columns');
  });

  it('leaves the page underneath reachable', () => {
    open(true);

    // Radix marks the rest of the document `aria-hidden` only for a MODAL surface.
    // A popover open over a live conversation must not: the transcript is the
    // thing being read.
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });
});
