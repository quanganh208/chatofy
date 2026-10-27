import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * A multi-line text field with the same edge, fill and states as `Input` — see
 * that file for why a field draws a light `--border` edge. This is the
 * mechanical extension of that treatment onto a control whose height tracks its
 * content instead of sitting fixed at 40px.
 *
 * `field-sizing-content` is what lets the height grow with typed content
 * rather than clip it, down to a `min-h-20` floor (three lines, so an empty
 * field still looks like somewhere to write a paragraph) and with no ceiling —
 * this primitive exists for the AI-context description, which can run long.
 * Resizing is vertical only: a sideways drag only ever breaks the form column.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content flex min-h-20 w-full resize-y min-w-0 rounded-md px-3 py-2',
        'bg-card text-body text-foreground shadow-field inset-ring-1 inset-ring-border',
        // 16px under a touch pointer, as `Input` — iOS zooms into smaller fields.
        'pointer-coarse:text-base',
        'placeholder:text-muted-foreground',
        // Colour and shadow only, matching `Input` — a field has no transform to
        // animate.
        'transition-[color,background-color,box-shadow] duration-fast ease-standard',
        'motion-reduce:transition-none',
        // The edge turns to the primary ink and nothing moves, same as `Input`.
        'hover:inset-ring-primary/40',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:inset-ring-ring',
        // Invalid is an escalation, driven by `aria-invalid` rather than a prop
        // so what is seen and what is announced cannot drift apart.
        'aria-invalid:ring-[1px] aria-invalid:ring-destructive aria-invalid:inset-ring-destructive',
        // Both conditions spelled out rather than left to source order, since
        // the two are equal specificity.
        'aria-invalid:focus-visible:ring-[3px] aria-invalid:focus-visible:ring-destructive/50',
        'aria-invalid:hover:inset-ring-destructive aria-invalid:focus-visible:inset-ring-destructive',
        // Read-only still holds real content, so the ink stays; only the
        // pointer response goes.
        'read-only:cursor-default read-only:hover:inset-ring-border',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
