'use client';

import Link from 'next/link';
import { BookOpen, LogOut, MoreHorizontal } from 'lucide-react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';
import { cn } from '@/lib/utils';
import { CreditLine } from './credit-line';
import { SETTINGS_ITEM } from './nav-items';
import { IdentityAvatar, useSessionIdentity } from './session-identity';
import { TAB_CLASS } from './tab-bar-styles';

/**
 * The fourth tab: what the sidebar holds that the tab bar has no room for.
 *
 * Glossary and Settings, who you are with the credit line, and sign out — the same
 * identity hook and the same sign-out action the sidebar footer uses, so the two never
 * disagree about either. A bottom sheet rather than a page: none of it is a place you
 * stay, and the sheet closes on any choice.
 *
 * On a route it covers (Glossary, any Settings page) the trigger carries
 * `aria-current="page"` as the other tabs' links do, so a screen reader hears which tab
 * is current there too; `data-active` alone only draws it.
 */
const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-body text-foreground outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:text-muted-foreground';

export function MoreSheet({ active }: { active: boolean }) {
  const t = useTranslate();
  const identity = useSessionIdentity();

  return (
    <Sheet>
      <SheetTrigger
        className={TAB_CLASS}
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
      >
        <MoreHorizontal aria-hidden />
        <span>{t('web.chrome.tabMore')}</span>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        closeLabel={t('web.chrome.close')}
        className="gap-2 rounded-t-lg pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="pb-0">
          <SheetTitle>{t('web.chrome.tabMore')}</SheetTitle>
          {/* Radix wants a description or an explicit opt-out; the identity line below
              is the most useful thing to read first. */}
          <SheetDescription className="sr-only">
            {identity.name ?? identity.email ?? t('web.chrome.tabMore')}
          </SheetDescription>
        </SheetHeader>
        <nav aria-label={t('web.chrome.tabMore')} className="flex flex-col gap-1 px-2">
          <SheetClose asChild>
            <Link href="/glossary" className={ROW}>
              <BookOpen aria-hidden />
              {t('web.chrome.navGlossary')}
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link href={SETTINGS_ITEM.href} className={ROW}>
              <SETTINGS_ITEM.icon aria-hidden />
              {t(SETTINGS_ITEM.labelKey)}
            </Link>
          </SheetClose>
        </nav>
        {identity.status === 'authenticated' ? (
          <div className="border-hairline mx-2 flex flex-col gap-1 border-t pt-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <IdentityAvatar identity={identity} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body truncate font-medium">
                  {identity.name ?? identity.email}
                </span>
                <CreditLine />
              </span>
            </div>
            <button
              type="button"
              id="sign-out-sheet"
              className={cn(ROW, 'text-left')}
              onClick={() => void signOutOfChatofy()}
            >
              <LogOut aria-hidden />
              {t('common.auth.signOut')}
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
