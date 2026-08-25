'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '../lib/utils.js';

/**
 * A continuous value along a track.
 *
 * `onValueChange` fires on every pointer move, which is what makes a slider feel
 * live — and what makes it expensive if a caller treats each tick as a commit.
 * Radix also exposes `onValueCommit`, firing once when the pointer or key is
 * released; a caller that persists to storage or hits the network belongs there,
 * and only the cheap live effect belongs in `onValueChange`. Both are passed
 * through untouched, so that decision stays with the caller rather than being
 * made here.
 *
 * `Range` is the filled part behind the thumb, which is what makes the value
 * readable at a glance without a numeric label. The thumb keeps the kit's 3px
 * focus ring: a slider is operated by arrow keys as often as by pointer, and a
 * ring narrower than the rule would make the one control most used from the
 * keyboard the hardest to locate.
 */
function Slider({
  className,
  value,
  defaultValue,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  // One thumb per value, because Radix renders exactly the thumbs it is given. A
  // fixed single thumb would typecheck against `value={[a, b]}` and then render a
  // range whose second handle cannot be grabbed or reached by keyboard — it
  // compiles, it renders, and it is silently unusable.
  const thumbCount = Math.max(1, (value ?? defaultValue ?? [0]).length);

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      className={cn(
        'relative flex w-full touch-none items-center select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          className={cn(
            'block size-4 shrink-0 rounded-full bg-card',
            'border border-border-control shadow-elev-sm',
            'transition-[box-shadow,border-color] duration-fast ease-standard',
            'motion-reduce:transition-none',
            'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            // `data-[disabled]`, not `disabled:` — the thumb is a span with
            // role="slider", and the form-element variant would never match it.
            'data-[disabled]:pointer-events-none',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
