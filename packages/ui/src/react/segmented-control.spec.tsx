// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control.js';

/**
 * The keyboard contract of the segmented control.
 *
 * This file predates the component it now guards. It was written against the
 * hand-rolled version, deliberately, so that swapping in a Radix primitive would
 * have something to go red — the plan for that work named "the existing a11y test
 * goes red" as its signal, and the signal could not fire while no such test
 * existed.
 *
 * The swap has happened: the control is built on `ToggleGroup` now. Two things
 * about what that changed are worth writing down, because the obvious summary of
 * it is wrong in both directions.
 *
 * **The ARIA contract did not change.** Radix gives a `type="single"` ToggleGroup
 * `role="radiogroup"` and every item `role="radio"` with `aria-checked`, removing
 * `aria-pressed` outright. Every role assertion below is the one that was here
 * before the swap, unedited.
 *
 * **The behaviour did change, and the component changes it back.** Radix uses
 * roving focus: arrows move focus, and selection waits for Enter, Space or a
 * click. Left alone that contradicts the role it just announced. So
 * `segmented-control.tsx` wires arrow keys back to selection, and
 * `selects as focus moves` below is the test that says so. It is the single most
 * deletable line in this file — nothing breaks visually without it, nothing fails
 * to compile — which is exactly why it is named for the behaviour rather than for
 * the key.
 *
 * The previous version of this comment recorded that arrow-selection could not be
 * asserted here at all, because Radix RadioGroup selected from a document-level
 * listener whose ordering jsdom does not reproduce. That limitation belonged to
 * that primitive. The handler is this component's own now, so the whole contract
 * is testable and none of it is left to a manual browser pass.
 */

// Testing Library's automatic cleanup runs from a global `afterEach`, which
// vitest only installs under `globals: true`. This suite is explicit instead —
// without it every `render` accumulates and `getByRole` finds two of everything.
afterEach(cleanup);

/**
 * jsdom implements no `ResizeObserver`, and the component uses one to re-measure
 * the thumb when the track changes width.
 *
 * Stubbed here rather than feature-detected in the component. Every browser this
 * ships to has had `ResizeObserver` for years, so a guard there would be dead
 * code in production whose only purpose is to keep a test environment quiet —
 * and it would silently swallow the real thing going missing. The gap belongs to
 * jsdom, so the fix belongs to the file that chose jsdom.
 *
 * It observes nothing: layout in jsdom never changes, so a working implementation
 * would never fire either. What is asserted below is roles and keyboard, none of
 * which depends on the thumb having a measured position.
 */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

/**
 * Which option the keyboard is on.
 *
 * Read from `data-value`, not `value`: Radix takes `value` as a prop and does not
 * reflect it onto the button, so the attribute the hand-rolled version exposed is
 * simply not there. `segmented-control.tsx` sets `data-value` for this, and for
 * the arrow handler that reads the same attribute at runtime.
 */
const current = () => document.activeElement?.getAttribute('data-value');

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
] as const;

function setup(value: 'a' | 'b' | 'c', props: { disabled?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Test group"
      value={value}
      options={OPTIONS}
      onChange={onChange}
      {...props}
    />,
  );
  const group = screen.getByRole('radiogroup');
  // Keyboard events are fired on the focused radio, not on the group.
  //
  // The first version of this file fired them at the container, which passed
  // against the hand-rolled control only because that one hung `onKeyDown` there.
  // That is a fact about where a handler was attached, not about what the control
  // does. A person tabs to the group, lands on a radio, and presses an arrow —
  // asserting on that path is what makes these tests survive the implementation
  // changing underneath them.
  return { onChange, group, user: userEvent.setup() };
}

describe('SegmentedControl keyboard behaviour', () => {
  it('is a radiogroup of radios, not a toolbar of buttons', () => {
    // Unchanged across the move from RadioGroup to ToggleGroup, which is the
    // surprising part: `type="single"` renders radios, so the cost this swap was
    // expected to carry — losing the radio semantics — never came due.
    const { group } = setup('a');
    expect(group.getAttribute('aria-label')).toBe('Test group');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the current option with aria-checked', () => {
    setup('b');
    expect(screen.getByRole('radio', { name: 'Bravo' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false');
    // `aria-pressed` is what a toggle carries. Radix deletes it in single mode,
    // and a control announcing both would be announcing two different widgets.
    expect(screen.getByRole('radio', { name: 'Bravo' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('moves to the next option on ArrowRight and ArrowDown', async () => {
    const { user } = setup('a');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(current()).toBe('b');
    await user.keyboard('{ArrowDown}');
    expect(current()).toBe('c');
  });

  it('moves to the previous option on ArrowLeft and ArrowUp', async () => {
    const { user } = setup('c');
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(current()).toBe('b');
    await user.keyboard('{ArrowUp}');
    expect(current()).toBe('a');
  });

  // Radix's `loop` is opt-in on some primitives and on by default on others, so
  // these two are the assertions most likely to catch a silent change underneath.
  it('wraps forward past the last option', async () => {
    const { user } = setup('c');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(current()).toBe('a');
  });

  it('wraps backward past the first option', async () => {
    const { user } = setup('a');
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(current()).toBe('c');
  });

  /**
   * The behaviour the component adds back, and the reason this file exists.
   *
   * A ToggleGroup on its own moves focus and waits to be told to select. That is
   * correct for a toolbar and wrong for something announcing itself as a radio
   * group: a screen reader says "radio, 1 of 3", the reader presses an arrow, and
   * nothing changes. `segmented-control.tsx` reports the focused item after Radix
   * has moved focus.
   *
   * If this test is ever deleted along with the handler it guards, nothing else
   * here fails. The value simply stops following the arrow keys, and only someone
   * driving the control from a keyboard would find out.
   */
  it('selects as focus moves, so an arrow key changes the value', async () => {
    const { onChange, user } = setup('a');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('selects on Enter and on Space', async () => {
    const { onChange, user } = setup('a');
    screen.getByRole('radio', { name: 'Charlie' }).focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('c');

    onChange.mockClear();
    screen.getByRole('radio', { name: 'Bravo' }).focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('selects on click', () => {
    const { onChange } = setup('a');
    screen.getByRole('radio', { name: 'Charlie' }).click();
    expect(onChange).toHaveBeenCalledWith('c');
  });

  /**
   * Pressing the current option must not clear the value.
   *
   * Radix treats a selected item pressed again as a deactivation and reports the
   * empty string. That is right for a toggle and wrong here: a segmented control
   * always has a value, and a caller handed `''` has no option to render as
   * current. The component drops it rather than passing it on.
   */
  it('never reports an empty value when the current option is pressed again', () => {
    const { onChange } = setup('b');
    screen.getByRole('radio', { name: 'Bravo' }).click();
    expect(onChange).not.toHaveBeenCalledWith('');
  });

  /**
   * One tab stop for the whole widget, wherever it sits.
   *
   * Counted across the group and its radios together, deliberately. The
   * hand-rolled version put the stop on the selected radio and left the container
   * with none; Radix puts it on the container and holds every radio at -1 until
   * focus enters. Both are correct roving-tabindex patterns and both give a
   * person one Tab press. Asserting the mechanism instead of the outcome would
   * have failed a working control, which is how a test teaches people to edit
   * the test.
   */
  it('gives the widget exactly one tab stop', () => {
    const { group } = setup('b');
    const stops = [group, ...screen.getAllByRole('radio')].filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
  });

  it('still offers a tab stop when nothing is selected', () => {
    // A group whose value matches no option must not become unreachable — every
    // node at -1 is a control a keyboard cannot get to at all.
    render(
      <SegmentedControl label="Unset" value={'zzz' as 'a'} options={OPTIONS} onChange={() => {}} />,
    );
    const stops = [screen.getByRole('radiogroup'), ...screen.getAllByRole('radio')].filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
  });

  /**
   * Disabled means the keyboard cannot reach it either.
   *
   * The component's own comment says three independent things enforce this, and
   * that swapping `disabled` for `aria-disabled` — which keeps the control
   * focusable — would silently end live conversations. Both halves are asserted:
   * the radios are genuinely disabled, and a keydown reaching the group anyway
   * changes nothing.
   */
  it('cannot be operated while disabled', async () => {
    const { onChange, group, user } = setup('a', { disabled: true });
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
    // And nothing in the widget is a tab stop, so a keydown cannot originate
    // inside it in the first place.
    const stops = [group, ...screen.getAllByRole('radio')].filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(0);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl selection mark', () => {
  /**
   * One element paints selection, and it is not the segments.
   *
   * Stock shadcn paints `data-[state=on]` on the item, which means the mark
   * teleports: two elements repaint and nothing connects the old position to the
   * new one. Putting that background back is the easiest way to undo the thumb
   * without touching the thumb, so it is asserted rather than left to review.
   */
  it('paints selection with a single travelling thumb, not on the item', () => {
    render(<SegmentedControl label="Test group" value="b" options={OPTIONS} onChange={() => {}} />);
    const thumb = document.querySelector('[data-slot="segmented-control-thumb"]');
    expect(thumb, 'the thumb is what draws the current segment').not.toBeNull();
    expect(thumb!.getAttribute('aria-hidden')).toBe('true');

    const selected = screen.getByRole('radio', { name: 'Bravo' });
    expect(
      selected.className,
      'a selected segment must not paint its own background — the thumb does it',
    ).toContain('data-[state=on]:bg-transparent');
  });
});
