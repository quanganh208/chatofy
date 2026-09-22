import Link from 'next/link';
import { BrandMark } from '@chatofy/ui/react';
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
 * Deliberately small in the app: the wordmark there is no larger than a translation
 * line (`text-translation`), because on a translate surface the translation is what
 * someone is here to read and a product name set at heading size competes with it. It
 * is a way home, not a headline. Only the marketing header, at the 32px mark, sets it
 * at `text-heading`.
 *
 * `href` is a prop, and every one of the four call sites passes nothing. It was added
 * for a hub that the app chrome would point at instead of the landing page; the hub is
 * gone and "home" turned out to be one address after all. Kept as a prop rather than
 * hard-coded because it borrows `Link`'s own type, so typed routes still reject an
 * address this app does not have — but if a second address never appears, this should
 * become a plain constant.
 *
 * The lotus mark sits before the wordmark, sized by the caller and coloured by the
 * size rule in `docs/brand-mark.md`: below 32px it is the one-colour ink
 * mark, because the dawn centre petal disappears when small; from 32px the centre
 * petal carries the dawn gradient. The wordmark is live Newsreader text, lowercase
 * as drawn, and the link's accessible name stays "Chatofy".
 *
 * The mark is the FIRST child and the wordmark the LAST, and the collapsed sidebar
 * relies on that: it hides the last child and keeps the mark.
 */
export function Brand({
  href = '/',
  size = 24,
  className,
}: {
  href?: React.ComponentProps<typeof Link>['href'];
  /** The mark's edge in px. 32 and up draws the dawn variant. */
  size?: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Chatofy"
      className={cn(
        'focus-visible:ring-ring/50 flex items-center gap-2 rounded-sm focus-visible:ring-[3px] focus-visible:outline-none',
        className,
      )}
    >
      <BrandMark variant={size >= 32 ? 'dawn' : 'ink'} size={size} />
      <span
        className={cn(
          'font-display leading-none font-medium tracking-tight',
          size >= 32 ? 'text-heading' : 'text-translation',
        )}
      >
        chatofy
      </span>
    </Link>
  );
}
