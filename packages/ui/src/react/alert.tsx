import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils.js';

/**
 * Two severities, told apart twice over.
 *
 * The extension popup already distinguished these by fill AND hue — an outlined
 * card for "this is how things are" against a filled amber one for "you have a
 * step left" — so that someone who cannot separate the two colours still reads
 * the difference. The web app had hue alone. This takes the stronger of the two,
 * which is what makes it a merge rather than a pick.
 *
 * `live` is the red one and it is not `destructive`: it reports that a
 * translation stopped, which is a state, not an act. shadcn's `destructive`
 * remains for genuine destructive confirmations, and currently carries the same
 * hex — they will not always want to.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-body has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        // Outlined. The ordinary case: something is being reported, not asked.
        default: 'border-hairline bg-card text-card-foreground shadow-elev-sm',
        // Filled, and the fill is the whole edge.
        //
        // These used to add a full-strength rule in their own hue on top of the
        // fill — `border-warning` is #7A4E00, a dark brown drawn around a pale
        // amber box, and it read as the heaviest line on the popup. The fill was
        // already doing the separating, so the rule was a third signal repeating
        // what two others said, and under a direction that separates by depth it
        // is the wrong idiom outright.
        //
        // The two signals that matter are untouched: the FILL still distinguishes
        // "you have a step left" from "this is being reported", and the hue still
        // distinguishes amber from red — so a reader who separates neither colour
        // still gets the difference from whether the notice is filled at all.
        //
        // The `[&_[data-slot=button]]:` rules are a WCAG 1.4.11 fix, not styling.
        // An outlined control inside a filled notice sits on `warningSubtle` /
        // `liveSubtle`, not on `surface` — and `borderControl` against those
        // measures 2.95, 2.87 and 2.70:1, under the 3:1 floor for the visual
        // boundary of a user interface component. It went unseen because the
        // contrast table only ever paired `borderControl` with `surface` and
        // `surfaceRaised`, so a control standing on a notice was a question it
        // had no row for.
        //
        // `skin-guard.spec.ts` asserts these two overrides, and it rather than
        // the contrast table is the right place: a ratio between two tokens
        // cannot see which token a component asks for. Delete the lines below and
        // every floor in `contrast-floors.spec.ts` still passes while these
        // buttons fall back to `borderControl` at 2.70:1.
        //
        // Re-bordering in the notice's own hue clears the floor (6.39:1 on amber)
        // and reads as belonging to the notice rather than as a stray grey box.
        //
        // This is now a RECORDED EXCEPTION to direction C1, not a leftover. C1
        // took the outline off every other control and accepted a 1.13:1 at-rest
        // edge to do it; on a filled notice that trade was refused, and the
        // reason is measured. The alternative considered was moving the hue from
        // the border to the FILL, which puts the notice's own ink on its own hue:
        // 1.90:1 in dark, 2.58:1 in light on `warning`, 2.88:1 on `live` in both.
        // That is not C1's at-rest-boundary trade, it is 1.4.3's 4.5:1 for the
        // LABEL, and the primary consumer is the button that opens the user's
        // microphone (`settings-pane.tsx`). No `onWarning` ink token exists to
        // fix it, and minting one is a palette change.
        //
        // The WIDTH is set here too, and that is load-bearing rather than tidy.
        // These overrides name a border COLOUR, and until C1 they leaned on the
        // `outline` variant to supply the 1px. It no longer does — the C1 quiet
        // button carries no border at all — so a colour on its own would render
        // nothing while `skin-guard.spec.ts` went on finding the class it greps
        // for. That is the exact failure that spec's own comment warns about, one
        // level further in: the assertion would stay green and the buttons would
        // drop to a 2.70:1 edge that is not there.
        //
        // `border-[1px]` rather than `border`, so the two arrive as one utility
        // and neither can be dropped without the other. Its selector carries an
        // attribute match, so it outranks the base `border-0` on specificity and
        // not on source order.
        live: [
          'border-transparent bg-live-subtle text-foreground shadow-elev-sm',
          '[&_[data-slot=button]]:border-[1px] [&_[data-slot=button]]:border-live',
        ].join(' '),
        warning: [
          'border-transparent bg-warning-subtle text-foreground shadow-elev-sm',
          '[&_[data-slot=button]]:border-[1px] [&_[data-slot=button]]:border-warning',
        ].join(' '),
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-body text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
