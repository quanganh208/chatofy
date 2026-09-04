// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttributionOrigin, SessionSpeaker } from '@chatofy/realtime-client';
import { SpeakerChip } from './speaker-chip';
// The chip reads its words from the dictionary, so it needs the provider its
// page gives it. Left at the default locale: what is asserted below is which
// string appears in which state, not how English words it.
import { LocaleProvider } from '@/i18n/provider';

/**
 * What a restyle is allowed to change about this chip: how it looks. Not what it
 * claims.
 *
 * Two of these are the design's load-bearing rules rather than component
 * details, and both fail silently — the screen simply reads as more certain than
 * it is, and nobody reports a bug about a label that looks confident:
 *
 * 1. A turn nobody attributed must never render a person's name.
 * 2. A suggested label must never look like a confirmed one, including after the
 *    conversation has stopped, which is when the transcript is actually read.
 */

const SPEAKERS: SessionSpeaker[] = [
  { id: 'speaker-1', label: 'An' },
  { id: 'speaker-2', label: 'Bình' },
];

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

const render = (props: Partial<Parameters<typeof SpeakerChip>[0]> = {}) => {
  const handlers = {
    onAttribute: vi.fn<(speakerId: string) => void>(),
    onUnattribute: vi.fn<() => void>(),
    onAddSpeaker: vi.fn<() => void>(),
    onRenameSpeaker: vi.fn<(speakerId: string, label: string) => void>(),
    onRemoveSpeaker: vi.fn<(speakerId: string) => void>(),
  };
  act(() => {
    root.render(
      <LocaleProvider>
        <SpeakerChip
          speakers={SPEAKERS}
          speaker={null}
          origin="fallback"
          attributions={{}}
          {...handlers}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return handlers;
};

const buttons = () => [...container.querySelectorAll('button')];
const buttonNamed = (text: string) =>
  buttons().find((button) => button.textContent?.trim() === text);

const click = (element: Element | undefined) => {
  expect(element, 'the control under test is not rendered').toBeTruthy();
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/**
 * Every state a chip can be in, derived from the union rather than listed.
 *
 * A hardcoded list is how a new member quietly escapes the rules below — it
 * happened once already, when `pending` was added and this file kept checking
 * three states. `satisfies` makes the compiler refuse a list that has drifted.
 */
const ORIGINS = ['confirmed', 'suggested', 'pending', 'fallback'] satisfies AttributionOrigin[];

describe('an unattributed turn', () => {
  it('asks rather than naming anybody', () => {
    render();

    expect(container.textContent).toContain('Who spoke?');
    for (const speaker of SPEAKERS) {
      expect(container.textContent).not.toContain(speaker.label);
    }
  });

  it('offers the control as a button, so it can be reached by keyboard', () => {
    render();

    // A click handler on a span is reachable by mouse only, and this is the one
    // affordance a person has to correct what the transcript claims.
    const chip = buttons()[0];
    expect(chip).toBeTruthy();
    expect(chip?.tagName).toBe('BUTTON');
    expect(chip?.hasAttribute('disabled')).toBe(false);
  });
});

describe('choosing who spoke', () => {
  it('reports the speaker that was picked', () => {
    const handlers = render();

    click(buttons()[0]);
    click(buttonNamed('Bình'));

    expect(handlers.onAttribute).toHaveBeenCalledWith('speaker-2');
  });

  it('collapses back after a choice, so a transcript is not left full of pickers', () => {
    render();

    click(buttons()[0]);
    expect(buttonNamed('An')).toBeTruthy();
    click(buttonNamed('An'));

    expect(buttonNamed('An')).toBeFalsy();
  });

  it('offers saying nobody named spoke', () => {
    // The only way out of a roster holding one person and one mistaken
    // attribution: that speaker cannot be removed while a turn still names them.
    const handlers = render();

    click(buttons()[0]);
    click(buttonNamed('Nobody'));

    expect(handlers.onUnattribute).toHaveBeenCalledOnce();
  });

  it('offers adding somebody from the turn itself', () => {
    const handlers = render();

    click(buttons()[0]);
    click(buttonNamed('Add a person'));

    expect(handlers.onAddSpeaker).toHaveBeenCalledOnce();
  });

  it('closes on Escape without attributing anything', () => {
    const handlers = render();

    click(buttons()[0]);
    act(() => {
      buttons()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(handlers.onAttribute).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Who spoke?');
  });
});

describe('telling a suggestion from a confirmation', () => {
  it('renders a confirmed label as settled', () => {
    render({ speaker: SPEAKERS[0], origin: 'confirmed' });

    const chip = buttons()[0];
    expect(chip?.textContent).toContain('An');
    expect(chip?.className).not.toContain('italic');
    expect(chip?.className).not.toContain('border-dashed');
  });

  it('renders a suggested label as unfinished', () => {
    // Same vocabulary the live line uses for text that may still change. If this
    // ever matches the confirmed styling, a machine guess reads as a person's
    // answer — and after the session ends, which is when the transcript is read,
    // there is nothing else left to tell them apart.
    render({ speaker: SPEAKERS[0], origin: 'suggested' });

    const chip = buttons()[0];
    expect(chip?.textContent).toContain('An');
    expect(chip?.className).toContain('italic');
    expect(chip?.className).toContain('border-dashed');
  });

  it('never fills a chip with the accent, in any state', () => {
    // The accent appears once per screen and /translate already spends it on the
    // primary action. Five people talking would put a dozen on screen.
    //
    // Driven off ORIGINS rather than a literal list. The list was
    // `['confirmed','suggested','fallback']` and stayed that way when
    // `AttributionOrigin` gained `pending`, so the new state was silently exempt
    // from the one rule this file exists to hold — the exact fail-open the union
    // was widened to prevent.
    for (const origin of ORIGINS) {
      render({ speaker: SPEAKERS[0], origin });
      expect(buttons()[0]?.className).not.toContain('bg-primary');
    }
  });

  it('gives every state its own look', () => {
    // A state that renders identically to another is a state the reader cannot
    // act on. `pending` and `fallback` both show no name, so the difference
    // between "an answer is coming" and "nobody said" has to be carried
    // somewhere, and the class list is where.
    const seen = new Map<string, AttributionOrigin>();
    for (const origin of ORIGINS) {
      render({
        speaker: origin === 'pending' || origin === 'fallback' ? null : SPEAKERS[0],
        origin,
      });
      const className = buttons()[0]?.className ?? '';
      const twin = seen.get(className);
      expect(twin, `${origin} looks exactly like ${twin}`).toBeUndefined();
      seen.set(className, origin);
    }
  });

  it('says which state it is in, not only shows it', () => {
    // `pending` and `fallback` both hold no speaker, so both once rendered the
    // same words and the same `aria-label` — leaving the difference between
    // "an answer is coming" and "nobody said" to a class list. A reader who
    // cannot see the border could not tell which promise the chip was making,
    // and `pending` is the state most likely to change under them.
    const nameless = ORIGINS.filter((origin) => origin === 'pending' || origin === 'fallback');
    const seen = new Map<string, AttributionOrigin>();

    for (const origin of nameless) {
      render({ speaker: null, origin });
      const button = buttons()[0];
      const spoken = `${button?.textContent ?? ''}|${button?.getAttribute('aria-label') ?? ''}`;
      const twin = seen.get(spoken);
      expect(twin, `${origin} reads exactly like ${twin}`).toBeUndefined();
      seen.set(spoken, origin);
    }

    expect(seen.size).toBe(nameless.length);
  });

  it('never dims a chip below the contrast floor', () => {
    // The floor `apps/web/src/design/contrast-floors.spec.ts` holds every token
    // pairing to cannot see an opacity composite, so it passed a `pending` tone
    // that measured 2.29:1 on the dark ground against a 4.5 floor. These are
    // interactive controls, so no disabled-control exemption applies. Opacity
    // below this is how a state gets styled out of legibility while every
    // mechanical gate stays green.
    for (const origin of ORIGINS) {
      render({
        speaker: origin === 'pending' || origin === 'fallback' ? null : SPEAKERS[0],
        origin,
      });
      const className = buttons()[0]?.className ?? '';
      const dimmed = /opacity-(\d+)/.exec(className);
      if (dimmed) {
        expect(Number(dimmed[1]), `${origin} is dimmed to ${dimmed[1]}%`).toBeGreaterThanOrEqual(
          80,
        );
      }
    }
  });
});

/**
 * The face that used to be a row under the transcript.
 *
 * What these hold is the reason the row could be deleted at all: every operation
 * it offered is still reachable, and the one wanted before anybody exists did not
 * move behind a second click.
 */
describe('renaming and removing', () => {
  it('keeps adding a person on the first face, where it works with an empty roster', () => {
    // The case this protects: nobody has been added yet, so there is nothing to
    // rename or remove and the manage face would be empty. Add has to be here.
    const handlers = render({ speakers: [] });

    click(buttons()[0]);
    click(buttonNamed('Add a person'));

    expect(handlers.onAddSpeaker).toHaveBeenCalled();
  });

  it('offers no manage face while there is nobody to manage', () => {
    render({ speakers: [] });

    click(buttons()[0]);

    expect(buttonNamed('Rename or remove')).toBeFalsy();
  });

  it('reaches the name field through the picker', () => {
    render();

    click(buttons()[0]);
    click(buttonNamed('Rename or remove'));

    const named = [...container.querySelectorAll('input')].map((input) => input.value);
    expect(named).toEqual(SPEAKERS.map((speaker) => speaker.label));
  });

  it('reports a removal against the person it was aimed at', () => {
    const handlers = render();

    click(buttons()[0]);
    click(buttonNamed('Rename or remove'));
    click(buttons().find((button) => button.getAttribute('aria-label')?.includes('Bình')));

    expect(handlers.onRemoveSpeaker).toHaveBeenCalledWith('speaker-2');
  });

  it('refuses to remove somebody a turn still names', () => {
    // The chip is what knows the attributions, so this rule has to survive the
    // move from the roster — a speaker removed here would leave the transcript
    // naming nobody for turns somebody spoke.
    const handlers = render({
      attributions: { 'session-1': { speakerId: 'speaker-1', origin: 'confirmed' } },
    });

    click(buttons()[0]);
    click(buttonNamed('Rename or remove'));
    const remove = buttons().find((button) => button.getAttribute('aria-label')?.includes('An'));

    expect(remove?.hasAttribute('disabled')).toBe(true);
    expect(handlers.onRemoveSpeaker).not.toHaveBeenCalled();
  });

  it('closes back to the chip, so a transcript is not left full of open rosters', () => {
    render();

    click(buttons()[0]);
    click(buttonNamed('Rename or remove'));
    click(buttonNamed('Done'));

    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Who spoke?');
  });
});

/**
 * What moving a singleton onto a per-turn control costs, if nobody checks.
 *
 * The roster was rendered once on the screen. The manage face is rendered on
 * every turn, so anything in it that was unique BY CONSTRUCTION is now unique
 * only per instance — and focus, which the permanently-mounted roster never took
 * away, is now torn down every time a face closes.
 */
describe('the manage face as a per-turn control', () => {
  const renderTwo = () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    container.append(first, second);
    const roots = [createRoot(first), createRoot(second)];
    act(() => {
      for (const chipRoot of roots) {
        chipRoot.render(
          <LocaleProvider>
            <SpeakerChip
              speakers={SPEAKERS}
              speaker={null}
              origin="fallback"
              attributions={{}}
              onAttribute={vi.fn()}
              onUnattribute={vi.fn()}
              onAddSpeaker={vi.fn()}
              onRenameSpeaker={vi.fn()}
              onRemoveSpeaker={vi.fn()}
            />
          </LocaleProvider>,
        );
      }
    });
    return () => act(() => roots.forEach((chipRoot) => chipRoot.unmount()));
  };

  it('gives every name field its own id, with two chips open at once', () => {
    // Keyed on the speaker, these collided: two inputs, one id, and every label
    // in the document resolving to the first — so a screen reader announces the
    // wrong person's name for the field being typed into.
    const unmount = renderTwo();
    for (const chip of [...container.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Who spoke?'),
    )) {
      click(chip);
    }
    for (const manage of [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Rename or remove',
    )) {
      click(manage);
    }

    const ids = [...container.querySelectorAll('input')].map((input) => input.id);
    expect(ids.length).toBe(SPEAKERS.length * 2);
    expect(new Set(ids).size).toBe(ids.length);
    unmount();
  });

  it('puts focus back on the chip when the manage face closes', () => {
    // Closing unmounts the focused field. Without this the browser drops focus
    // to `<body>`, and somebody renaming a speaker on the fourth turn has to
    // traverse the whole sidebar to get back to where they were.
    render();
    const chip = buttons()[0];
    click(chip);
    click(buttonNamed('Rename or remove'));
    act(() => container.querySelector('input')?.focus());
    click(buttonNamed('Done'));

    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('refuses to add past the ceiling, and says the ceiling', () => {
    // `addSpeaker` returns the roster untouched at the limit, so an enabled
    // button here is a press that changes nothing and reports nothing. The
    // roster that used to carry this sentence permanently is gone.
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `speaker-${index}`,
      label: `P${index}`,
    }));
    const handlers = render({ speakers: many });

    click(buttons()[0]);
    const add = buttons().find((button) => /Limit is/.test(button.textContent ?? ''));
    expect(add?.disabled).toBe(true);
    expect(handlers.onAddSpeaker).not.toHaveBeenCalled();
  });
});
