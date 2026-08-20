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
        default: 'border-border bg-card text-card-foreground',
        live: 'border-live bg-live-subtle text-foreground',
        // Filled. This one is asking for something, and the fill is the second
        // signal carrying that on its own.
        warning: 'border-warning bg-warning-subtle text-foreground',
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
