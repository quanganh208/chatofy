import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';

/**
 * The one place that decides how wide a page is, how much air it has, and how its
 * regions are spaced.
 *
 * Before this, each route decided for itself and they disagreed: `/translate` was
 * `max-w-2xl … gap-8 px-6 py-10`, the turn-based page `max-w-xl … justify-center
 * gap-6 p-6`, and `/` had no layout at all. Three routes, three answers, and no way
 * back from the third — which is most of why the app read as a set of test harnesses
 * rather than one product.
 *
 * `measure` is a variant, not an escape hatch, and it exists because a landing page
 * and a live transcript genuinely want different line lengths. The rule that matters
 * is that the *values* live here: a route asks for `wide` or `reading`, it does not
 * name a width. A criterion that demanded one single width for every route would only
 * have pushed someone to launder a second value through a wrapper file.
 *
 * The brand is deliberately small. On a translate surface the translation is what
 * someone is here to read, and a product name set at display size competes with it
 * for the one thing the page is for. It is a way home, not a headline.
 */
interface AppShellProps {
  children: React.ReactNode;
  /** `reading` narrows the measure for prose-led pages; `wide` suits a transcript. */
  measure?: 'wide' | 'reading';
  /**
   * A way back, rendered beside the brand. Omit on the surface it would point at.
   *
   * `href` borrows `Link`'s own type rather than taking a `string`: this app has Next's
   * typed routes on, so a plain string is rejected at the call site — which is the
   * behaviour worth keeping. A back link to a route that does not exist is exactly the
   * dead end this shell was added to remove.
   */
  back?: { href: React.ComponentProps<typeof Link>['href']; label: string };
  className?: string;
}

const MEASURE = {
  wide: 'max-w-2xl',
  reading: 'max-w-xl',
} as const;

export function AppShell({ children, measure = 'wide', back, className }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-4', MEASURE[measure])}>
          <Link
            href="/"
            className="text-body focus-visible:ring-ring flex items-center gap-2 font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <span aria-hidden className="bg-primary size-2.5 rounded-sm" />
            Chatofy
          </Link>
          {back ? (
            <Link
              href={back.href}
              className="text-prose text-hint hover:text-foreground focus-visible:ring-ring ml-auto underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {back.label}
            </Link>
          ) : null}
          {/* Declared once, here, for the same reason the page measures are: three
              routes each mounting their own would be three chances to disagree. */}
          <ThemeToggle className={back ? '' : 'ml-auto'} />
        </div>
      </header>

      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-8 px-6 py-8',
          MEASURE[measure],
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
