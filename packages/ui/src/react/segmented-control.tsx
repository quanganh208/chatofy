import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '../lib/utils.js';

/**
 * A row of segments where exactly one is current.
 *
 * Built on Radix's RadioGroup rather than its ToggleGroup, and that is not
 * interchangeable. A ToggleGroup moves focus with the arrow keys and commits with
 * Enter; a RadioGroup selects as it moves. The control this replaces was written
 * as `role="radiogroup"` with focus following selection, and
 * `segmented-control.spec.tsx` pins that down — swapping in a ToggleGroup would
 * turn those assertions red, which is the whole reason they were written before
 * the swap rather than after.
 *
 * Radix supplies what the hand-rolled version implemented itself: roving
 * tabindex, wrap-around, both axes, and a tab stop even when the value matches no
 * option. What stays hand-written is the appearance, because a segmented control
 * is not what shadcn's radio-group looks like.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  /** Shown above the group and announced as its name. */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
  /** Explains the current choice under the control. */
  hint?: React.ReactNode;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
  hint,
}: SegmentedControlProps<T>) {
  // Tied to the group rather than left as a loose sibling paragraph: the hint is
  // the only place some of these choices are explained, and unassociated it is
  // never announced.
  const hintId = React.useId();

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {label}
      </span>
      <RadioGroupPrimitive.Root
        data-slot="segmented-control"
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as T)}
        // Left unset on purpose. With an explicit orientation Radix binds one
        // axis only; the control this replaces answered to all four arrows, and
        // the spec asserts it.
        className={cn('bg-muted inline-flex w-fit gap-1 rounded-md p-1', disabled && 'opacity-45')}
      >
        {options.map((option) => (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            data-slot="segmented-control-item"
            className={cn(
              'inline-flex items-center gap-2 rounded-sm px-3 py-1.5',
              'text-body font-medium whitespace-nowrap transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
              // Offset against the track this sits inside, not the page behind
              // it — otherwise the gap renders as a dark notch.
              'focus-visible:ring-offset-muted focus-visible:outline-none',
              'disabled:cursor-not-allowed',
              // Ink, not the accent. A screen gets one accent-filled control —
              // the action it exists to offer — and a selected segment is a
              // statement of current value rather than something to press.
              'data-[state=checked]:bg-secondary data-[state=checked]:text-foreground',
              'data-[state=checked]:shadow-sm',
              'data-[state=unchecked]:text-muted-foreground',
              'data-[state=unchecked]:hover:text-foreground',
              'data-[state=unchecked]:not-disabled:hover:bg-secondary',
            )}
          >
            {option.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-hint max-w-prose">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
