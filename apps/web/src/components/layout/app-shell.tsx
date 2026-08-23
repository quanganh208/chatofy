import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { SessionMenu } from './session-menu';
import { ConnectedThemeToggle } from './theme-toggle-connected';

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
      {/* `border-hairline`, like every other surface separation. The page rule was
          the last thing still drawn at full strength after the depth pass, which
          made the quietest element on the page its darkest line. */}
      <header className="border-hairline border-b">
        <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-4', MEASURE[measure])}>
          <Link
            href="/"
            className="text-body focus-visible:ring-ring/50 flex items-center gap-2 rounded-sm font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <span aria-hidden className="bg-primary size-2.5 rounded-sm" />
            Chatofy
          </Link>
          {back ? (
            <Link
              href={back.href}
              className="text-prose text-hint hover:text-foreground focus-visible:ring-ring/50 ease-standard duration-fast ml-auto rounded-sm underline underline-offset-4 transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:outline-none"
            >
              {back.label}
            </Link>
          ) : null}
          {/*
            One right-aligned group rather than `ml-auto` on the first control.
            SessionMenu renders nothing when signed out — on the login page, for
            instance — and hanging the alignment off a component that can vanish
            would leave the theme toggle stranded beside the brand there.

            The toggle is declared once, here, for the same reason the page
            measures are: three routes each mounting their own would be three
            chances to disagree.
          */}
          <div className={cn('flex items-center gap-2', back ? '' : 'ml-auto')}>
            <SessionMenu className="flex items-center gap-2" />
            <ConnectedThemeToggle />
          </div>
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
