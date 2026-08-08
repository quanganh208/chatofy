'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * One-of-N choice, as one control rather than a row of buttons.
 *
 * Direction, mode and voice are each a single choice among two, and each was
 * rendered as two independent buttons whose selected one happened to be a
 * different colour. A screen reader met them as two buttons, arrow keys did
 * nothing, and on screen nothing said the two belonged together.
 *
 * `radiogroup` rather than a tablist: these change a setting, they do not switch
 * what is displayed. Roving tabindex, so the group is one tab stop and the arrow
 * keys move within it — which is what the role promises and what makes it
 * usable without a mouse.
 *
 * The disabled state is load-bearing rather than cosmetic. Mode and direction are
 * held while a session is running, because switching unmounts the panel and drops
 * the conversation mid-sentence. Three independent things enforce it, and it is
 * worth knowing that they are three: `disabled` on each `button` blocks the
 * click, the container has no `tabIndex` so no keydown can originate inside a
 * disabled group, and `move()` returns early. Swapping `disabled` for
 * `aria-disabled` — a common "improvement", since it keeps the control
 * focusable — would remove the first two and silently end live conversations.
 * The unit suite runs in node with no DOM, so nothing here would catch that.
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
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((option) => option.value === value);
  // Tied to the group rather than left as a loose sibling paragraph: the Mode
  // hint is the only place cascade and live are explained, and unassociated it is
  // never announced.
  const hintId = React.useId();

  function move(delta: number): void {
    if (disabled || options.length === 0) return;
    const from = selected === -1 ? 0 : selected;
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    // Focus follows selection, which is what a radiogroup does: the arrow keys
    // are the way you choose, not a separate way to browse.
    refs.current[next]?.focus();
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          'bg-muted inline-flex w-fit gap-1 rounded-[var(--radius-md)] p-1',
          disabled && 'opacity-45',
        )}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {options.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              // Roving tabindex: one stop for the whole group.
              tabIndex={active || (selected === -1 && index === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5',
                'text-sm font-medium whitespace-nowrap transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
                // Offset against the track this sits inside, not the page behind
                // it — otherwise the gap renders as a dark notch.
                'focus-visible:ring-offset-muted focus-visible:outline-none',
                'disabled:cursor-not-allowed',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground not-disabled:hover:bg-secondary',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint ? (
        <p id={hintId} className="text-muted-foreground max-w-prose text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
