import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Hover and active are real colour steps rather than `opacity-90`.
 *
 * Fading a button on a dark background reads as "disabled", not as "hovered" —
 * the two states were previously drawn the same way, one by opacity and the other
 * by opacity. Each variant now moves along the token scale instead.
 *
 * `live` is separate from `destructive` although they currently carry the same
 * hex. Stopping a translation is not a destructive act, it is the end of the
 * running state, and the two will not always want the same treatment.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)]',
    'text-body font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-45 disabled:border-transparent',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-accent-hover',
        // `live-fill`, not `live`. White on `live` is 3.91 and fails AA; on this
        // it is 4.93. These are the buttons that stop a recording, so they are
        // the last place to accept text you have to squint at.
        //
        // `on-live-fill` and not `primary-foreground`: the accent is bright
        // enough that its own ink is dark, and dark on this red is 3.96. Red
        // fills keep the white they always needed, under their own name.
        live: 'bg-live-fill text-on-live-fill hover:brightness-110',
        destructive: 'bg-live-fill text-on-live-fill hover:brightness-110',
        outline: 'border-border-control border bg-transparent hover:bg-secondary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-border',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6 text-body',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = 'Button';

/** shadcn convention: variant helper exported for composition. @public */
export { buttonVariants };
