import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * A multi-line text field, drawn as the same well `Input` is cut into — see
 * that file for the full account of why a field is inset rather than raised,
 * and what boundary contrast that trades away. This is the mechanical
 * extension of the same recess, fill behaviour, and focus/invalid handling
 * onto a control whose height tracks its content instead of sitting fixed at
 * 40px.
 *
 * `field-sizing-content` is what lets the height grow with typed content
 * rather than clip it, down to a `min-h-16` floor and with no ceiling — this
 * primitive exists for the AI-context description, which can run long.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content flex min-h-16 w-full min-w-0 rounded-md px-3 py-2',
        'bg-background text-body text-foreground shadow-field',
        'placeholder:text-muted-foreground',
        // Colour and shadow only, matching `Input` — a field has no transform to
        // animate.
        'transition-[color,background-color,box-shadow] duration-fast ease-standard',
        'motion-reduce:transition-none',
        // The fill deepens and nothing moves, same as `Input`.
        'hover:bg-muted',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // Invalid is an escalation, driven by `aria-invalid` rather than a prop
        // so what is seen and what is announced cannot drift apart.
        'aria-invalid:ring-[1px] aria-invalid:ring-destructive',
        // Both conditions spelled out rather than left to source order, since
        // the two are equal specificity.
        'aria-invalid:focus-visible:ring-[3px] aria-invalid:focus-visible:ring-destructive/50',
        // Read-only still holds real content, so the ink stays; only the
        // pointer response goes.
        'read-only:cursor-default read-only:hover:bg-background',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
