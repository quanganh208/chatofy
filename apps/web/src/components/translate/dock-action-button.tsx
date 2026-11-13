'use client';

import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
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
 * **The label shows only on a wide main column** (`@[72rem]/main`), not at the
 * dock's own 46rem layout switch. Measured live: at a 768px column (a 1024px
 * window) the three labelled buttons overlapped End while a conversation ran, and
 * a 1024px column only just fits them before a context name or the longer
 * Vietnamese words are added. Narrower, the button is a square icon and the label
 * moves to a tooltip on hover and focus. The accessible name is passed separately and must contain
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
  /** The visible word in the dock; the tooltip, when shown, says the accessible name. */
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
    <DockButtonWithTooltip label={label} className={className} {...props}>
      {children}
    </DockButtonWithTooltip>
  );
}

/**
 * The dock variant. The tooltip opens only while the word is hidden: its content
 * portals to the body, outside the `main` container, so no container class can
 * hide it at the wide breakpoint — and a bubble repeating the word beside it is
 * noise, which Radix would also read out as a description. So the open state asks
 * the one element that knows: is the word on screen right now.
 *
 * The tooltip says the whole accessible name, not the short word. "Captions" is
 * enough beside an icon at full width; alone, the reader needs to know WHICH
 * window it opens, which is what the name was written to say.
 */
function DockButtonWithTooltip({
  label,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'children'> & {
  label: string;
  children: ReactNode;
}) {
  const word = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const wordHidden = () => !word.current || getComputedStyle(word.current).display === 'none';

  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={(next) => setOpen(next && wordHidden())}>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={cn('text-foreground @[72rem]/main:w-auto @[72rem]/main:px-3', className)}
            {...props}
          >
            {children}
            <span ref={word} className="hidden @[72rem]/main:inline">
              {label}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{props['aria-label'] ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
