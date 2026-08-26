import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { MEASURE, type Measure } from './measures';
import { ConnectedThemeToggle } from './theme-toggle-connected';

/**
 * The minimal frame, for the surfaces that are neither the product nor the pitch.
 *
 * Three of them: the auth routes, the two unlinked lab routes, and the 404. They have
 * the same need — the brand as a way home, a way to change theme, and one measured
 * column — and no need for navigation.
 *
 * This is what is left of the old shell after the split, and the subtraction is the point.
 * It also carried the session menu, which is why a sign-out control used to be
 * one render away from appearing on a password-reset page; here there is no session
 * anything, so the rule "`(auth)` shows no way out because there is no way in yet" is
 * structural rather than a coincidence of `SessionMenu` returning `null` when signed
 * out. Product navigation is not here either — that is `AppChrome`, and the two do not
 * share a file so that neither can drift into the other.
 *
 * The theme toggle stays. It is not navigation and not session state; it is how someone
 * reads the page at all, and taking it away from the auth routes would be a capability
 * these pages have today.
 *
 * `back` exists for the lab routes, which are reachable only by URL and would otherwise
 * be dead ends. The auth pages carry their own return links in the page body, next to
 * the form they belong to.
 */
export function PlainFrame({
  children,
  measure = 'reading',
  back,
  className,
}: {
  children: React.ReactNode;
  measure?: Measure;
  /** A way back. `href` borrows `Link`'s type, so typed routes reject a dead end. */
  back?: { href: React.ComponentProps<typeof Link>['href']; label: string };
  className?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* `border-hairline`, like every other surface separation. A page rule drawn at
          full strength makes the quietest element on the page its darkest line. */}
      <header className="border-hairline border-b">
        <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-4', MEASURE[measure])}>
          <Brand />
          {back ? (
            <Link
              href={back.href}
              className="text-prose text-hint hover:text-foreground focus-visible:ring-ring/50 ease-standard duration-fast ml-auto rounded-sm underline underline-offset-4 transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:outline-none"
            >
              {back.label}
            </Link>
          ) : null}
          <div className={cn('flex items-center gap-2', back ? '' : 'ml-auto')}>
            <ConnectedThemeToggle />
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
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
