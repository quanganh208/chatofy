import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * A text field, drawn as a well cut into the surface.
 *
 * The primitive that should have existed already. Before this, `apps/web` and the
 * extension popup each declared their own class string for the same control, and
 * both reached for `border-hairline` — a SURFACE token measuring 1.34:1, which
 * `globals.css` ends by saying must never stand in for `--border-control`.
 *
 * ## Why a field is inset and a button is not
 *
 * This is the asymmetry someone will eventually try to tidy away, so it is
 * written here rather than inferred. Direction C1 tells a field from a button by
 * the DIRECTION OF DEPTH, not by fill:
 *
 * - a field is a well — `--inset-field`, and it never moves;
 * - a button is an object sitting on the surface — `--elevation-sm`, lifting 1px
 *   on hover and pressing 1px on active.
 *
 * Fill cannot carry that distinction here: `card` and `secondary` are 1.10:1
 * apart, which is a difference nobody sees. Make the two match and the language
 * collapses — every control becomes the same object and nothing says which one
 * accepts typing.
 *
 * ## What C1 gives up, on the record
 *
 * The inset edge composites to 1.13:1 (light) and 1.17:1 (dark), under WCAG
 * 1.4.11's 3:1 for the boundary of a control at rest. Nothing softer than
 * `--border-control` reaches that floor in this palette — `border-strong` is
 * 2.07/1.87, `border` is 1.27/1.23 — so it is a property of the ramp, not a value
 * to tune. It was accepted deliberately, against a measured alternative that
 * cleared the floor. The focus ring is untouched and still carries state
 * indication at 6.70:1 worst-case, so it is the AT-REST boundary alone that was
 * traded. `docs/design-guidelines.md` holds the full record.
 *
 * ## Composition, not replacement
 *
 * The recess arrives through `shadow-field`, a `--shadow-*` namespace utility, so
 * it composes into `--tw-shadow` and the focus ring lands ON it. An arbitrary
 * `[box-shadow:…]` would overwrite the whole declaration and take the ring with
 * it — the trap `globals.css` already records beside the elevation aliases.
 *
 * Height is 40px, matching `Button`'s `size.default`. They only agree at 40.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-md px-3 py-2',
        'bg-background text-body text-foreground shadow-field',
        'placeholder:text-muted-foreground',
        // Colour and shadow only. A field has no transform to animate, which is
        // the entire difference from `Button` — and why the escape below is
        // `transition-none` rather than a transform-specific one.
        'transition-[color,background-color,box-shadow] duration-fast ease-standard',
        'motion-reduce:transition-none',
        // The fill deepens and NOTHING moves. That restraint is the mechanism:
        // a control that stays put while its neighbour lifts is the one you type
        // into.
        'hover:bg-muted',
        // Matching `Button` exactly, because one focus rule across the product is
        // the point of this alignment. There is no border to tint here, so the
        // ring carries it alone — it composes over the recess rather than
        // replacing it, so the field does not pop flat at the moment of focus.
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // Invalid is an escalation, and the one place a real boundary is still
        // wanted — so it draws one. Driven by `aria-invalid` rather than a prop,
        // so what is seen and what is announced cannot drift apart.
        'aria-invalid:ring-[1px] aria-invalid:ring-destructive',
        // Both conditions at once, spelled out rather than left to source order.
        // `aria-invalid:ring-[1px]` and `focus-visible:ring-[3px]` are equal
        // specificity, and which won would otherwise be decided by the generated
        // stylesheet's order — the accident this repo refuses to build on.
        'aria-invalid:focus-visible:ring-[3px] aria-invalid:focus-visible:ring-destructive/50',
        // Read-only still holds real content, so the ink stays. What goes is the
        // response: a control that answers the pointer while refusing the
        // keyboard is the one that reads as broken.
        'read-only:cursor-default read-only:hover:bg-background',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        // `type="file"` renders a button inside the field, and the user agent
        // gives it a border and its own type scale. Neutralised here so a
        // primitive that carries no product vocabulary also carries no surprise.
        'file:inline-flex file:border-0 file:bg-transparent file:text-body file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
