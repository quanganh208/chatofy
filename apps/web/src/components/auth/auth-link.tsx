import Link from 'next/link';
import type { Route } from 'next';

/**
 * A quiet link between auth screens.
 *
 * The focus ring is the point of having this at all: the same four utilities were
 * written out at every one of these links, and a ring dropped from one of them is
 * invisible until somebody navigates the screen by keyboard. One definition, five
 * screens.
 */
export function AuthLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
