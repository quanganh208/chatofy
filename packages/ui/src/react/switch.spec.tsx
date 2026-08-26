// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './switch.js';

/**
 * What a Switch has to do that reading its class list cannot prove.
 *
 * `skin-guard.spec.ts` sweeps the file TEXT, so it can prove the string
 * `focus-visible:ring-[3px]` is present and nothing more. Whether the control takes
 * focus, announces the right role, and responds to the keys its role promises is a
 * separate question, and it is the one that breaks silently across a Radix bump.
 *
 * Assertions are raw DOM rather than jest-dom matchers, matching
 * `segmented-control.spec.tsx` — this package installs no matcher extensions.
 */

// Testing Library's automatic cleanup runs from a global `afterEach`, which vitest
// only installs under `globals: true`. Explicit here for the same reason as the
// sibling spec.
afterEach(cleanup);

describe('Switch', () => {
  it('announces state rather than a press', () => {
    // The whole reason this is not a Toggle. `aria-pressed` would say "an action
    // happened"; a setting needs "this is how things are".
    render(<Switch aria-label="Voice output" />);
    const control = screen.getByRole('switch', { name: 'Voice output' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.hasAttribute('aria-pressed')).toBe(false);
  });

  it('reaches focus by keyboard', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Voice output" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('switch'));
  });

  it('toggles with Space', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Voice output" onCheckedChange={onCheckedChange} />);

    await user.tab();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('toggles by pointer', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Voice output" onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not respond when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Voice output" disabled onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('carries the kit-wide focus ring width', () => {
    // 3px is the rule across every control in this package. A component that picks
    // its own width makes the one thing keyboard users navigate by inconsistent.
    render(<Switch aria-label="Voice output" />);
    expect(screen.getByRole('switch').className).toContain('focus-visible:ring-[3px]');
  });
});
