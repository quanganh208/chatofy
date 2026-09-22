import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-hint font-medium whitespace-nowrap transition-[color,box-shadow] duration-fast ease-standard motion-reduce:transition-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        // `bg-accent-hover`, not `bg-primary/90`. This carried the CLI's stock
        // fade until the skin guard grew a row for it — the same treatment
        // `button.tsx`'s `default` was corrected to, and for the same reason:
        // fading a filled control on a dark ground reads as disabled.
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-accent-hover',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'bg-destructive text-white focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/90',
        outline: 'border-border text-foreground [a&]:hover:bg-secondary [a&]:hover:text-foreground',
        ghost: '[a&]:hover:bg-secondary [a&]:hover:text-foreground',
        // Underlined at rest: `text-primary` is ink, the colour of every other
        // word, so without the line nothing says this is a link.
        link: 'text-primary underline underline-offset-4 [a&]:hover:decoration-2',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
