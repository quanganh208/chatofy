'use client';

import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * A vertical drag handle that sets the width of the panel it sits on.
 *
 * It is the WAI-ARIA window splitter: `role="separator"` that is focusable, with
 * `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. That is what makes a width a
 * setting a keyboard or screen-reader user can change too; a drag-only handle would have
 * made it a mouse-only one.
 *
 * Controlled: it reports the width it wants through `onChange` and draws nothing but the
 * grip. The caller owns the number (and where it is stored), so one handle serves a
 * sidebar and a call's chat panel.
 *
 * - `grow` says which way a pointer moving away from the panel's far edge widens it:
 *   `"right"` for a handle on the right edge of a left-hand panel, `"left"` for a handle
 *   on the left edge of a right-hand one. The arrow keys follow the same direction.
 * - Arrow keys move 16px, Shift moves 64px, Home and End go to the limits.
 * - A double click calls `onReset`.
 * - `onDragStart` and `onDragEnd` let the caller switch off any width transition while
 *   the pointer is down, so the panel follows the pointer instead of trailing it.
 */
const STEP = 16;
const STEP_LARGE = 64;

type ResizeHandleProps = {
  /** Names the handle for assistive technology, e.g. "Sidebar width". */
  label: string;
  /** Current width in px. */
  value: number;
  min: number;
  /** A number, or a function for a limit that depends on the window. */
  max: number | (() => number);
  grow: 'left' | 'right';
  onChange: (width: number) => void;
  onReset?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  className?: string;
};

export function ResizeHandle({
  label,
  value,
  min,
  max,
  grow,
  onChange,
  onReset,
  onDragStart,
  onDragEnd,
  className,
}: ResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  const limit = () => (typeof max === 'function' ? max() : max);
  const clamp = (width: number) => Math.min(limit(), Math.max(min, Math.round(width)));
  const sign = grow === 'right' ? 1 : -1;

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    onDragEnd?.();
  };

  // Never leave the page unselectable if the handle goes away mid-drag.
  React.useEffect(
    () => () => {
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    },
    [],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={limit()}
      tabIndex={0}
      data-slot="resize-handle"
      data-dragging={dragging}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width: value };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        document.body.style.setProperty('user-select', 'none');
        document.body.style.setProperty('cursor', 'col-resize');
        onDragStart?.();
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(clamp(drag.current.width + sign * (event.clientX - drag.current.x)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(event) => {
        const step = event.shiftKey ? STEP_LARGE : STEP;
        let next: number | null = null;
        if (event.key === 'ArrowRight') next = value + sign * step;
        else if (event.key === 'ArrowLeft') next = value - sign * step;
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = limit();
        if (next === null) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
      className={cn(
        'group/resize absolute inset-y-0 z-20 flex w-3 cursor-col-resize touch-none justify-center outline-none',
        'pointer-coarse:w-5',
        className,
      )}
    >
      {/* The visible grip: a hairline that thickens and takes the focus colour when the
          handle is hovered, focused or being dragged. Nothing here is a state colour. */}
      <span
        aria-hidden
        className={cn(
          'h-full w-px bg-transparent transition-colors duration-fast ease-standard motion-reduce:transition-none',
          'group-hover/resize:bg-border-strong group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-ring',
          'group-data-[dragging=true]/resize:w-0.5 group-data-[dragging=true]/resize:bg-ring',
        )}
      />
    </div>
  );
}
