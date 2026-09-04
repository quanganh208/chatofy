// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Slider } from './slider.js';

/**
 * The Slider's keyboard contract and its thumb arithmetic.
 *
 * A slider is operated by arrow keys at least as often as by pointer, and jsdom
 * cannot drag — so the keyboard path is both the more important one to guard and
 * the only one testable here. Pointer behaviour is Radix's own and is not
 * re-asserted.
 *
 * The multi-thumb case is here because it is the failure that compiles: the props
 * accept `value={[a, b]}`, and a component rendering one fixed thumb would show a
 * range whose second handle can never be grabbed or focused.
 */

afterEach(cleanup);

/**
 * jsdom implements no `ResizeObserver`; Radix's Slider measures its thumb with one.
 *
 * Stubbed here rather than guarded in the component, for the reason
 * `segmented-control.spec.tsx:47-60` sets out: every browser this ships to has had
 * `ResizeObserver` for years, so a guard in the component would be dead code whose
 * only job is to quiet a test environment — and it would swallow the real thing
 * going missing. The gap belongs to jsdom, so the fix belongs to the file that
 * chose jsdom.
 */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

describe('Slider', () => {
  it('renders one thumb for a single value', () => {
    render(<Slider aria-label="Volume" defaultValue={[0.5]} min={0} max={1} step={0.1} />);
    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });

  it('renders one thumb per value', () => {
    // Radix renders exactly the thumbs it is given; a fixed single thumb would make
    // the second value unreachable while still typechecking and still rendering.
    render(<Slider aria-label="Range" defaultValue={[0.2, 0.8]} min={0} max={1} step={0.1} />);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('reaches focus by keyboard', async () => {
    const user = userEvent.setup();
    render(<Slider aria-label="Volume" defaultValue={[0.5]} min={0} max={1} step={0.1} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('slider'));
  });

  it('increments with ArrowRight and decrements with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Slider
        aria-label="Volume"
        defaultValue={[0.5]}
        min={0}
        max={1}
        step={0.1}
        onValueChange={onValueChange}
      />,
    );

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith([expect.closeTo(0.6, 5)]);

    await user.keyboard('{ArrowLeft}');
    expect(onValueChange).toHaveBeenLastCalledWith([expect.closeTo(0.5, 5)]);
  });

  it('reports its bounds to assistive technology', () => {
    render(<Slider aria-label="Volume" defaultValue={[0.5]} min={0} max={1} step={0.1} />);
    const thumb = screen.getByRole('slider');
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('1');
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.5');
  });

  it('does not respond when disabled', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Slider
        aria-label="Volume"
        defaultValue={[0.5]}
        min={0}
        max={1}
        step={0.1}
        disabled
        onValueChange={onValueChange}
      />,
    );

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('cuts its track into the surface rather than laying a rail on it', () => {
    // The depth pair: a field is a well, a control is an object. The track is the
    // field half and the thumb is the object riding in it, so a flat track put the
    // two at the same depth and left nothing saying which one you grab.
    //
    // Asserted as the `--shadow-*` token rather than a literal shadow: writing the
    // inset directly overwrites `--tw-shadow` and takes the focus ring with it,
    // which is the failure this whole namespace exists to prevent.
    render(<Slider defaultValue={[50]} />);
    const track = document.querySelector('[data-slot="slider-track"]');
    expect(track?.className).toContain('shadow-field');
  });

  it('carries the kit-wide focus ring width on the thumb', () => {
    render(<Slider aria-label="Volume" defaultValue={[0.5]} min={0} max={1} step={0.1} />);
    expect(screen.getByRole('slider').className).toContain('focus-visible:ring-[3px]');
  });
});
