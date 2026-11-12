// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from './resize-handle.js';

/**
 * A drag handle that can also be used without a pointer.
 *
 * The role is `separator` with `aria-valuenow`, the pattern for a movable splitter, so a
 * screen reader announces a width and a keyboard user can change it. Dragging alone would
 * have made the width a mouse-only setting.
 */
afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof ResizeHandle>> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  render(
    <ResizeHandle
      label="Sidebar width"
      value={256}
      min={200}
      max={360}
      grow="right"
      onChange={onChange}
      onReset={onReset}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...props}
    />,
  );
  return { handle: screen.getByRole('separator'), onChange, onReset, onDragStart, onDragEnd };
}

const pointer = (type: string, clientX: number) =>
  new MouseEvent(type, { clientX, bubbles: true, cancelable: true });

describe('ResizeHandle', () => {
  it('is a focusable vertical separator that reports its width', () => {
    const { handle } = setup();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('256');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('360');
    expect(handle.getAttribute('aria-label')).toBe('Sidebar width');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('moves by 16px with the arrow keys and by 64px with Shift', () => {
    const { handle, onChange } = setup();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(272);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(240);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(320);
  });

  it('reverses the arrows for a handle on the left edge of its panel', () => {
    const { handle, onChange } = setup({ grow: 'left' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(272);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(240);
  });

  it('jumps to the limits with Home and End and never passes them', () => {
    const { handle, onChange } = setup({ value: 350 });
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(360);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(360);
  });

  it('follows a drag to the right when the panel grows rightward', () => {
    const { handle, onChange, onDragStart, onDragEnd } = setup();
    fireEvent(handle, pointer('pointerdown', 100));
    expect(onDragStart).toHaveBeenCalledTimes(1);
    fireEvent(handle, pointer('pointermove', 140));
    expect(onChange).toHaveBeenLastCalledWith(296);
    fireEvent(handle, pointer('pointermove', 20));
    expect(onChange).toHaveBeenLastCalledWith(200); // 256 - 80 = 176, clamped to min
    fireEvent(handle, pointer('pointerup', 20));
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('follows a drag to the left when the panel grows leftward', () => {
    const { handle, onChange } = setup({ grow: 'left' });
    fireEvent(handle, pointer('pointerdown', 500));
    fireEvent(handle, pointer('pointermove', 460));
    expect(onChange).toHaveBeenLastCalledWith(296);
  });

  it('ignores movement when no drag is in progress', () => {
    const { handle, onChange } = setup();
    fireEvent(handle, pointer('pointermove', 300));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resets on a double click', () => {
    const { handle, onReset } = setup();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('accepts a limit that depends on the window', () => {
    const { handle, onChange } = setup({ max: () => 300 });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(300);
  });
});
