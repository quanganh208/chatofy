import * as React from 'react';
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * The toast host, re-skinned to this palette.
 *
 * **No `next-themes`.** The CLI wires the theme through it; this project has no theme
 * provider, because every token is one `light-dark()` declaration that already follows
 * the document's `color-scheme`. Sonner's own `theme` only picks its fallback colours,
 * and the variables below replace those, so `system` is right on both surfaces and a
 * caller may still pass the resolved choice.
 *
 * **Sonner styles with attribute selectors**, which outrank a single utility class, so
 * the overrides that must win carry Tailwind's `!` suffix. The surface is `card` at
 * `shadow-elev-lg` — a toast is over the page, the `lg` step — and its actions are the
 * quiet button rather than sonner's ink fill, so a toast never spends a screen's accent.
 *
 * **Reduced motion is sonner's own**: its stylesheet drops every transition and
 * animation on a toast under `prefers-reduced-motion: reduce`. The spinner below adds
 * its own escape, because that icon is ours.
 */
const Toaster = ({ toastOptions, style, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--card-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          fontFamily: 'inherit',
          ...style,
        } as React.CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: 'text-body! shadow-elev-lg! gap-3!',
          title: 'font-medium!',
          description: 'text-muted-foreground! text-hint!',
          actionButton:
            'bg-secondary! text-foreground! font-medium! h-8! px-3! rounded-md! pointer-coarse:h-11!',
          cancelButton:
            'bg-transparent! text-muted-foreground! h-8! px-3! rounded-md! pointer-coarse:h-11!',
          closeButton: 'bg-card! text-muted-foreground! border-border!',
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
};

export { Toaster, type ToasterProps };
