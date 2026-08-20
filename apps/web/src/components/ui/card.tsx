import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one card treatment. There used to be two.
 *
 * This primitive existed and the product's own panels ignored it: `cascade-panel`
 * and `live-panel` each hand-wrote `border-border bg-card … rounded-[var(--radius-lg)]
 * border p-6`, while `Card` was reachable only from the turn-based page and
 * `ResultCard`. The two drifted exactly where you would expect — the hand-written box
 * had no shadow and an 18px title, this one had `shadow-sm` and a 20px title — so the
 * product surface and the measurement surface looked like different applications.
 *
 * The shadow is gone rather than adopted. `docs/design-guidelines.md` defines
 * elevation through the neutral ramp (`bg` -> `surface` -> `surfaceRaised`), not
 * through shadows, and a drop shadow on a near-black ground reads as a smudge. The
 * panels' treatment won on that point; this one won on being a component.
 *
 * Sizes come from the role-named type scale, so a heading here is the same heading
 * everywhere: `text-heading` is the 22px section step the guidelines assign. The
 * Tailwind-named step it replaced belonged to no scale at all — see
 * `docs/design-guidelines.md` § Type, which holds that rationale precisely because
 * quoting the superseded utility name here would trip the sweep that removed it.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-border bg-card text-card-foreground rounded-lg border', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-heading font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-prose text-body max-w-prose', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

/** shadcn convention: full card part set kept exported. @public */
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}
