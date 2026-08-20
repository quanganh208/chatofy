// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control.js';

/**
 * The keyboard contract of the hand-rolled segmented control, written down
 * before it is replaced.
 *
 * There was no test for any of this — `apps/web` had three specs and none of
 * them touched a component. That gap is why the plan for this work listed "the
 * existing a11y test goes red" as the signal that swapping in a Radix primitive
 * had changed behaviour: a signal that could not fire, because the test did not
 * exist.
 *
 * So it is written here first, against the component being replaced, and it has
 * to pass before anything is swapped. Whatever replaces it inherits this file.
 * Every assertion below corresponds to a decision the component's own comments
 * argue for, which is what makes them worth preserving rather than merely
 * describing what the code happens to do today.
 *
 * One half of the contract is not expressible here. Radix moves focus with the
 * arrow keys and then selects whatever focus lands on, and that second step runs
 * off a document-level listener whose ordering neither jsdom nor happy-dom
 * reproduces — focus moves, the value does not follow. Driven through a real
 * Chromium against this exact component, tabbing in and pressing keys gives:
 *
 *   Tab -> a   ArrowRight -> b   ArrowRight -> c   ArrowRight -> a
 *   ArrowLeft -> c   ArrowDown -> a   ArrowUp -> c
 *
 * with `document.activeElement` equal to the selected radio at every step. That
 * is the same sequence the hand-rolled control produced. What is asserted below
 * is therefore the navigation half — order, wrap-around, both axes — which is
 * where a regression would actually show up, plus selection by click, which does
 * work here.
 */

// Testing Library's automatic cleanup runs from a global `afterEach`, which
// vitest only installs under `globals: true`. This suite is explicit instead —
// without it every `render` accumulates and `getByRole` finds two of everything.
afterEach(cleanup);

/** Which option the keyboard is on, by the value it carries. */
const current = () => document.activeElement?.getAttribute('value');

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
    // The distinction decides which Radix primitive may replace this. A
    // ToggleGroup moves focus with the arrows and selects with Enter; a
    // RadioGroup selects with the arrows. Only the second matches what is
    // asserted below, and what the component was written to do.
    const { group } = setup('a');
    expect(group.getAttribute('aria-label')).toBe('Test group');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
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

  // `% options.length` in `move()`. Radix's equivalent is opt-in (`loop`), so
  // these two are the assertions most likely to catch a silent change.
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

  it('selects on click', () => {
    // The half of "arrow moves focus, focus selects" that a test DOM can run.
    const { onChange } = setup('a');
    screen.getByRole('radio', { name: 'Charlie' }).click();
    expect(onChange).toHaveBeenCalledWith('c');
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
