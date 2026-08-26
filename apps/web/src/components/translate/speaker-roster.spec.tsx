// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttributionsBySession, SessionSpeaker } from '@chatofy/realtime-client';
import { SpeakerRoster } from './speaker-roster';
import { LocaleProvider } from '@/i18n/provider';

/**
 * What the roster has to survive: somebody typing a name into it.
 *
 * The reducer stores a trimmed label and refuses a blank one, and both rules are
 * right. What they cost is a field that fights the person using it, and the way
 * it fails is invisible to a test that only checks the callback fired: the
 * keystroke IS reported, the stored label simply does not change, and React puts
 * the field back. The assertions below read the field, not the callback, because
 * the field is the thing that was broken.
 *
 * The names here are the case that matters. A Vietnamese name is two or three
 * words, and so is the placeholder the roster hands out in both languages.
 */

const ATTRIBUTED: AttributionsBySession = {
  'session-1': { speakerId: 'speaker-1', origin: 'confirmed' },
};

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

/** Applies renames the way the reducer does, so the field is under the real rule. */
function Harness({
  initial,
  attributions = {},
  onRemove,
}: {
  initial: SessionSpeaker[];
  attributions?: AttributionsBySession;
  onRemove?: (speakerId: string) => void;
}) {
  const [speakers, setSpeakers] = useState(initial);
  return (
    <LocaleProvider>
      <SpeakerRoster
        speakers={speakers}
        attributions={attributions}
        onAdd={vi.fn()}
        onRemove={onRemove ?? vi.fn()}
        onRename={(speakerId, label) => {
          const trimmed = label.trim();
          if (!trimmed) return;
          setSpeakers((current) =>
            current.map((speaker) =>
              speaker.id === speakerId ? { ...speaker, label: trimmed } : speaker,
            ),
          );
        }}
      />
    </LocaleProvider>
  );
}

const render = (props: Parameters<typeof Harness>[0]) => {
  act(() => root.render(<Harness {...props} />));
  return container.querySelector('input') as HTMLInputElement;
};

/** One keystroke, driven through the native setter React listens to. */
const typeInto = (input: HTMLInputElement, next: string) => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// `focusout`, not `blur`: React delegates `onBlur` to the bubbling event.
const blur = (input: HTMLInputElement) => {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
};

describe('naming somebody', () => {
  it('lets a space be typed in the middle of a name', () => {
    const input = render({ initial: [{ id: 'speaker-1', label: 'Quang' }] });

    typeInto(input, 'Quang ');
    typeInto(input, `${input.value}Anh`);

    expect(input.value).toBe('Quang Anh');
  });

  it('keeps the whole name once typing stops', () => {
    const input = render({ initial: [{ id: 'speaker-1', label: 'Người nói 1' }] });

    typeInto(input, 'Nguyễn ');
    typeInto(input, `${input.value}Mạc `);
    typeInto(input, `${input.value}Quang Anh`);
    blur(input);

    expect(input.value).toBe('Nguyễn Mạc Quang Anh');
  });

  it('leaves the stored name alone when the field is cleared', () => {
    // A person with no name is not a state the transcript can render, so an
    // emptied field goes back to what the turns are already labelled with.
    const input = render({ initial: [{ id: 'speaker-1', label: 'An' }] });

    typeInto(input, '');
    blur(input);

    expect(input.value).toBe('An');
  });
});

describe('removing somebody', () => {
  it('refuses while a turn still names them, and says so', () => {
    const onRemove = vi.fn();
    render({
      initial: [{ id: 'speaker-1', label: 'An' }],
      attributions: ATTRIBUTED,
      onRemove,
    });

    const remove = [...container.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.includes('An'),
    );
    expect(remove?.hasAttribute('disabled')).toBe(true);
    expect(remove?.getAttribute('title')).toContain('named on a turn');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('allows it for somebody no turn names', () => {
    const onRemove = vi.fn();
    render({ initial: [{ id: 'speaker-1', label: 'An' }], onRemove });

    const remove = [...container.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.includes('An'),
    );
    act(() => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRemove).toHaveBeenCalledWith('speaker-1');
  });
});
