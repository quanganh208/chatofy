import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The product name, and a way home.
 *
 * Four surfaces draw it now — the sidebar, the marketing header, the plain frame,
 * and the mobile sheet the landing gets later — where the old shell used to be the only
 * one. Splitting the shell into per-group chrome is what created that fan-out, so the
 * mark itself moved here rather than being retyped four times with four slightly
 * different focus rings.
 *
 * Deliberately body-sized. On a translate surface the translation is what someone is
 * here to read, and a product name set at heading size competes with it. It is a way
 * home, not a headline — the same judgement the old shell recorded, kept.
 *
 * `href` is a prop because "home" is not one address: signed out it is the landing
 * page, and once `/dashboard` exists the app chrome points there instead. It borrows
 * `Link`'s own type rather than taking a `string`, so typed routes still reject an
 * address this app does not have.
 */
export function Brand({
  href = '/',
  className,
}: {
  href?: React.ComponentProps<typeof Link>['href'];
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'text-body focus-visible:ring-ring/50 flex items-center gap-2 rounded-sm font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:outline-none',
        className,
      )}
    >
      <span aria-hidden className="bg-primary size-2.5 shrink-0 rounded-sm" />
      <span>Chatofy</span>
    </Link>
  );
}
