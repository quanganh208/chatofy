'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@chatofy/ui/react';

/**
 * The header's nav, on a screen too narrow to hold it.
 *
 * It arrives now rather than in the chrome phase because there is finally something to
 * put in it: three anchors pointing at three sections that exist. A sheet holding two
 * buttons that already fit on a phone would have been a control with nothing to reveal.
 *
 * `SheetClose` around every link, and that is the part worth stating. These are in-page
 * anchors, so clicking one does not navigate — without an explicit close the sheet stays
 * open over the section it just scrolled to, which looks like the link did nothing.
 *
 * Its words are props. This is a client component and `getT` is server-only, so the
 * header — which is already reading the session on the server — passes them down. Same
 * arrangement as `ThemeToggle`'s labels.
 */
export interface MarketingMenuLink {
  href: string;
  label: string;
}

export function MarketingMenu({
  links,
  title,
  signedIn,
  actions,
}: {
  links: readonly MarketingMenuLink[];
  title: string;
  signedIn: boolean;
  actions: { openApp: string; signIn: string; getStarted: string };
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 md:hidden" aria-label={title}>
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {/* Named, like the header's own nav. Two navigation landmarks on one page
            and only one of them answering "which navigation?" is the case a
            landmark list is least useful in. `title` is the sheet's heading, so
            the two cannot drift. */}
        <nav aria-label={title} className="flex flex-col gap-1 px-4">
          {links.map((link) => (
            <SheetClose asChild key={link.href}>
              <a
                href={link.href}
                className="text-body hover:bg-secondary focus-visible:ring-ring/50 rounded-md px-2 py-2 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                {link.label}
              </a>
            </SheetClose>
          ))}
        </nav>
        <div className="mt-2 flex flex-col gap-2 px-4">
          {signedIn ? (
            <SheetClose asChild>
              <Button asChild>
                <Link href="/translate">{actions.openApp}</Link>
              </Button>
            </SheetClose>
          ) : (
            <>
              <SheetClose asChild>
                <Button asChild variant="outline">
                  <Link href="/login">{actions.signIn}</Link>
                </Button>
              </SheetClose>
              {/* The one filled control in this sheet. The header shows the same
                  action quietly because the hero's button shares its viewport; the
                  open sheet covers the hero, so here it is the action. */}
              <SheetClose asChild>
                <Button asChild>
                  <Link href="/register">{actions.getStarted}</Link>
                </Button>
              </SheetClose>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
