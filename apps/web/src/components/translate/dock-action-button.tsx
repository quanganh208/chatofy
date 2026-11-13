'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@chatofy/ui/react';
import { cn } from '@/lib/utils';

/**
 * A setup control in the translate dock: fullscreen, the caption window, the
 * display gear.
 *
 * **Outline, with a word, because ghost icons read as disabled.** These sat as
 * `ghost` icons, whose text is `muted-foreground`, and a row of grey glyphs beside
 * a live Start looks like a row of controls that are switched off. Outline puts a
 * hairline and a surface behind each, and the text is `foreground`, so they read as
 * things to press. Never accent: the screen's one filled control is Start.
 *
 * **The label shows when the main column is wide enough** (`@[46rem]/main`, the
 * breakpoint the dock itself switches layout at). Narrower, the button is a square
 * icon and the label moves to a tooltip on hover and focus, so the row does not
 * crowd Start on a phone. The accessible name is passed separately and must contain
 * the visible word (WCAG 2.5.3, label in name).
 *
 * `dock={false}` is the fullscreen bar: icon-only, outline, named by `title`. The
 * tooltip portals to the body, and the browser draws nothing outside a fullscreen
 * element, so a tooltip there would open unseen.
 */
export function DockActionButton({
  label,
  dock,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'children'> & {
  /** The visible word (and the tooltip text) in the dock. */
  label: string;
  /** True in the dock (label above the breakpoint, tooltip below); false in the fullscreen bar. */
  dock: boolean;
  /** The icon. */
  children: ReactNode;
}) {
  if (!dock) {
    return (
      <Button
        variant="outline"
        size="icon"
        title={props['aria-label']}
        className={cn('text-foreground', className)}
        {...props}
      >
        {children}
      </Button>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={cn('text-foreground @[46rem]/main:w-auto @[46rem]/main:px-3', className)}
            {...props}
          >
            {children}
            <span className="hidden @[46rem]/main:inline">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
