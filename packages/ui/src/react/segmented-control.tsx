import * as React from 'react';

import { cn } from '../lib/utils.js';
import { ToggleGroup, ToggleGroupItem } from './toggle-group.js';

/**
 * A row of segments where exactly one is current.
 *
 * Built on `ToggleGroup`, which is shadcn's primitive for this shape. What that
 * actually renders is worth stating, because the name misleads: Radix gives a
 * `type="single"` Root `role="radiogroup"` and each item `role="radio"` with
 * `aria-checked`, deleting `aria-pressed`. The ARIA contract is therefore the
 * same one this component had when it wrapped `RadioGroup` directly, and
 * `segmented-control.spec.tsx` still asserts it.
 *
 * **Arrow keys are wired back to selection, and that is the load-bearing part.**
 * Radix ToggleGroup uses roving focus: arrows move focus and selection waits for
 * Enter, Space or a click. A radio group is supposed to select as it moves, so
 * out of the box this announces "radio, 1 of 3" and then ignores the arrow key
 * the announcement invites — the role and the behaviour say different things.
 * `onKeyDown` below closes that. It does not re-implement navigation: Radix still
 * owns focus movement, and this only reports the item focus landed on.
 *
 * Delete that handler and nothing fails to compile, nothing looks wrong, and
 * keyboard users lose the ability to change the value with the key the control
 * tells them to use. The spec has a test named for exactly that.
 *
 * **Selection is painted by one moving element, not by each segment.** The thumb
 * travels; the items paint nothing. Two elements repainting says nothing
 * happened, and a mark that jumps between segments leaves nothing connecting the
 * two positions — which was most of what made this control feel dead.
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

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

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

  const trackRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLSpanElement>(null);
  // The first placement must not animate, or the thumb slides in from the corner
  // on the frame the control appears.
  const [ready, setReady] = React.useState(false);

  const place = React.useCallback(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const active = track.querySelector<HTMLElement>('[data-state="on"]');
    if (!active) {
      thumb.style.opacity = '0';
      return;
    }

    // `offsetLeft`/`offsetWidth` rather than viewport rects: they are relative to
    // the positioned track, so they survive scrolling and need no border
    // arithmetic. Measured rather than derived from the selected index, because
    // segments are text-width — "Việt → Anh" and "Anh → Việt" are not the same
    // width, and an index-positioned thumb lands wrong on the second one.
    thumb.style.opacity = '1';
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }, []);

  React.useLayoutEffect(() => {
    place();
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [place, value, options]);

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const observer = new ResizeObserver(place);
    observer.observe(track);
    // A font swapping in after first paint re-measures every label, and the thumb
    // would otherwise keep the width it was given before the swap.
    void document.fonts?.ready.then(place);
    return () => observer.disconnect();
  }, [place]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {label}
      </span>
      <ToggleGroup
        ref={trackRef}
        type="single"
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        disabled={disabled}
        // Radix deactivates an item that is pressed while already selected, which
        // reports `''`. A segmented control always has a value, so the empty one
        // is dropped rather than passed on as a state the caller cannot render.
        onValueChange={(next) => {
          if (next) onChange(next as T);
        }}
        onKeyDown={(event) => {
          if (!ARROWS.has(event.key) || disabled) return;
          // Queued, not read inline, and the reason is specific: Radix's roving
          // focus does its `focus()` inside a `setTimeout`, so at the moment this
          // handler runs `document.activeElement` is still the item the arrow was
          // pressed on. A zero-delay timeout lands behind that one and sees where
          // focus actually went.
          //
          // `requestAnimationFrame` reads correctly in a browser and never
          // resolves under the test DOM, which would leave the one behaviour this
          // handler exists for asserted by nothing.
          setTimeout(() => {
            const focused = document.activeElement;
            const next = focused instanceof HTMLElement ? focused.dataset.value : undefined;
            if (next && next !== value) onChange(next as T);
          });
        }}
        className={cn('bg-muted relative gap-1 rounded-md p-1', disabled && 'opacity-45')}
      >
        {/* Not a control and not content: it is the selection, drawn. Kept out of
            the a11y tree and out of the way of pointer events so it can never
            intercept a click meant for the segment underneath it. */}
        <span
          ref={thumbRef}
          aria-hidden
          data-slot="segmented-control-thumb"
          className={cn(
            'bg-card shadow-elev-sm pointer-events-none absolute top-0 left-0 rounded-sm',
            ready && 'transition-[transform,width,height] duration-base ease-standard',
            'motion-reduce:transition-none',
          )}
        />
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            data-value={option.value}
            data-slot="segmented-control-item"
            className={cn(
              'relative z-10 h-auto rounded-sm px-3 py-1.5',
              'text-body font-medium whitespace-nowrap',
              // Offset against the track this sits inside, not the page behind
              // it — otherwise the gap renders as a notch of the wrong ground.
              //
              // The WIDTH stays the shared 3px this control already inherits from
              // `Toggle`. It used to be overridden to `ring-2` here, which made
              // this the one control on either surface with a narrower focus ring
              // than the rule — the same contradiction `app-shell.tsx` carried,
              // in the opposite direction. Only the offset is local, and only the
              // offset needs to be.
              'focus-visible:ring-offset-muted focus-visible:ring-[3px] focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed',
              // No selected-state background here on purpose: the thumb is the
              // only thing that paints selection. Adding one back gives the
              // control two marks, one of which teleports.
              'data-[state=on]:bg-transparent data-[state=on]:text-foreground',
              'data-[state=off]:text-muted-foreground',
              'data-[state=off]:not-disabled:hover:text-foreground',
              'data-[state=off]:hover:bg-transparent',
            )}
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-hint max-w-prose">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
