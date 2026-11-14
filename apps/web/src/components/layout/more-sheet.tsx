'use client';

import { useRef, useState } from 'react';
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
import type { SettingsTabId } from '@/components/settings/settings-tab-ids';
import { openSettingsDialog } from '@/components/settings/use-settings-dialog';
import { SETTINGS_ENTRY } from './nav-items';
import { IdentityAvatar, useSessionIdentity } from './session-identity';
import { PlanBadge, usePlan } from './plan-badge';
import { SHEET_ROW_CLASS as ROW, TAB_CLASS } from './tab-bar-styles';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';

/**
 * The fourth tab: what the sidebar holds that the tab bar has no room for.
 *
 * Glossary and Settings, who you are with the credit line, and sign out — the same
 * identity hook and the same sign-out action the sidebar footer uses, so the two never
 * disagree about either. A bottom sheet rather than a page: none of it is a place you
 * stay, and the sheet closes on any choice.
 *
 * On the route it covers (Glossary) the trigger carries `aria-current="page"` as the
 * other tabs' links do, so a screen reader hears which tab is current there too;
 * `data-active` alone only draws it.
 *
 * The identity row carries the same plan pill as the sidebar footer, as text: the row
 * is already the button that opens Billing, so a second control inside it would be
 * both invalid and redundant.
 *
 * Settings and the credit line open the Settings dialog — on the list of tabs and on
 * Billing — over the current page. The dialog opens once the sheet has closed and
 * handed focus back to the More tab, so closing Settings returns focus there.
 */

export function MoreSheet({ active }: { active: boolean }) {
  const t = useTranslate();
  const identity = useSessionIdentity();
  const plan = usePlan();
  const trigger = useRef<HTMLButtonElement>(null);
  // What a row asked to open: the list (`null`) or a tab. `undefined` is nothing.
  const pending = useRef<SettingsTabId | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        ref={trigger}
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
        onCloseAutoFocus={(event) => {
          const tab = pending.current;
          if (tab === undefined) return;
          pending.current = undefined;
          // Focus the More tab first, so it is what the dialog returns focus to.
          event.preventDefault();
          trigger.current?.focus();
          openSettingsDialog(tab ?? undefined);
        }}
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
          {identity.status === 'authenticated' && (
            <WorkspaceSwitcher
              variant="sheet-row"
              onManageTeams={() => {
                pending.current = 'team';
                setOpen(false);
              }}
            />
          )}
          <SheetClose asChild>
            <Link href="/glossary" className={ROW}>
              <BookOpen aria-hidden />
              {t('web.chrome.navGlossary')}
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <button
              type="button"
              data-settings-entry
              aria-haspopup="dialog"
              className={cn(ROW, 'text-left')}
              onClick={() => {
                pending.current = null;
              }}
            >
              <SETTINGS_ENTRY.icon aria-hidden />
              {t(SETTINGS_ENTRY.labelKey)}
            </button>
          </SheetClose>
        </nav>
        {identity.status === 'authenticated' ? (
          <div className="border-hairline mx-2 flex flex-col gap-1 border-t pt-2">
            {/* Who you are and what is left: opens Settings › Billing, where the
                balance is explained. */}
            <SheetClose asChild>
              <button
                type="button"
                data-settings-tab="billing"
                aria-haspopup="dialog"
                className={cn(ROW, 'h-auto gap-3 py-2 text-left')}
                onClick={() => {
                  pending.current = 'billing';
                }}
              >
                <IdentityAvatar identity={identity} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-body truncate font-medium">
                      {identity.name ?? identity.email}
                    </span>
                    {plan === null ? null : <PlanBadge plan={plan} />}
                  </span>
                  <CreditLine />
                </span>
                <span className="sr-only">{t('web.settings.billing')}</span>
              </button>
            </SheetClose>
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
