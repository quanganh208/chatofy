'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '../lib/utils.js';

/**
 * An on/off control for a setting that takes effect on its own.
 *
 * A Switch rather than a `Toggle`, and the distinction is not cosmetic: `Toggle`
 * renders a button with `aria-pressed`, which announces "pressed" and reads as an
 * action that was performed. A switch announces its state, which is what a setting
 * like "speak the translation" actually is. Radix gives the Root `role="switch"`
 * with `aria-checked` and a hidden bubble input, so it also participates in a form
 * the way a checkbox would.
 *
 * The track carries the state and the thumb carries the motion. Both transitions
 * name their properties rather than using `transition-all`, so nothing animates the
 * focus ring — a ring that eases in reads as lag on a control that should feel
 * instant under the keyboard.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full',
        'border border-border-control shadow-elev-sm',
        'transition-[background-color,border-color] duration-fast ease-standard',
        'motion-reduce:transition-none',
        'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Unchecked sits on the same muted ground every inactive track uses, so an
        // off switch and an empty slider read as the same kind of "nothing here".
        'data-[state=unchecked]:bg-muted',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-card shadow-elev-sm ring-0',
          'transition-transform duration-fast ease-standard motion-reduce:transition-none',
          // Translated rather than justified: a flex jump has no intermediate state,
          // so the thumb would teleport and the control would feel broken rather
          // than switched.
          'data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
