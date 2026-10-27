import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * A text field: a white-on-ground well with a real edge.
 *
 * The primitive that should have existed already. Before this, `apps/web` and the
 * extension popup each declared their own class string for the same control, and
 * both reached for `border-hairline` — a SURFACE token measuring 1.34:1, which
 * `globals.css` ends by saying must never stand in for `--border-control`.
 *
 * ## The edge is what makes it a field
 *
 * At rest the field draws `--border` as a 1px inset ring on a `card` fill, and
 * on hover the edge turns to the primary ink. It replaced direction C1, which
 * drew no edge and filled with the page's own colour, so on the page ground
 * people could not find the box. `--border-control` (3:1+, WCAG 1.4.11's floor)
 * and then `--border-strong` were tried at rest and read as heavy; the hairline
 * is under the floor by decision, with the fill doing the separating.
 * `docs/design-guidelines.md` § *Control depth* has the record.
 *
 * The fill is `card`, so a field reads lighter than the stone page AND sits
 * flush on a card with its edge doing the work. The recess stays as a soft top
 * shadow: depth still says a field is cut in and a button sits on top, the edge
 * just no longer has to carry that alone.
 *
 * ## Composition, not replacement
 *
 * The recess arrives through `shadow-field` and the edge through `inset-ring-*`,
 * both of which compose into `box-shadow` alongside the focus ring rather than
 * overwriting it. An arbitrary `[box-shadow:…]` would take the ring with it — the
 * trap `globals.css` records beside the elevation aliases.
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
        'bg-card text-body text-foreground shadow-field inset-ring-1 inset-ring-border',
        // 16px under a touch pointer. iOS zooms the whole page into any focused
        // field set smaller than that, and 14px is this scale's body size. Keyed
        // to the pointer rather than the width: an iPad zooms too, and the
        // extension popup is narrow but never touched.
        'pointer-coarse:text-base',
        'placeholder:text-muted-foreground',
        // Colour and shadow only. A field has no transform to animate, which is
        // the entire difference from `Button` — and why the escape below is
        // `transition-none` rather than a transform-specific one.
        'transition-[color,background-color,box-shadow] duration-fast ease-standard',
        'motion-reduce:transition-none',
        // The edge turns to the primary ink and NOTHING moves — no fill change,
        // because a field that greys on hover reads as disabled.
        'hover:inset-ring-primary/40',
        // The edge turns to ink inside the product-wide ring, so focus reads as a
        // crisp line with a halo rather than a thick grey band.
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:inset-ring-ring',
        // Invalid is an escalation: the edge and an outer line both turn red.
        // Driven by `aria-invalid` rather than a prop, so what is seen and what is
        // announced cannot drift apart.
        'aria-invalid:ring-[1px] aria-invalid:ring-destructive aria-invalid:inset-ring-destructive',
        // Both conditions at once, spelled out rather than left to source order.
        // `aria-invalid:ring-[1px]` and `focus-visible:ring-[3px]` are equal
        // specificity, and which won would otherwise be decided by the generated
        // stylesheet's order — the accident this repo refuses to build on.
        'aria-invalid:focus-visible:ring-[3px] aria-invalid:focus-visible:ring-destructive/50',
        'aria-invalid:hover:inset-ring-destructive aria-invalid:focus-visible:inset-ring-destructive',
        // Read-only still holds real content, so the ink stays. What goes is the
        // response: a control that answers the pointer while refusing the
        // keyboard is the one that reads as broken.
        'read-only:cursor-default read-only:hover:inset-ring-border',
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
