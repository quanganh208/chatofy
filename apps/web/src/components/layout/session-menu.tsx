'use client';

import { useRef } from 'react';
import { ChevronsUpDown, CreditCard, LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';
import type { SettingsTabId } from '@/components/settings/settings-tab-ids';
import { openSettingsDialog } from '@/components/settings/use-settings-dialog';
import { IdentityAvatar, useSessionIdentity } from './session-identity';
import { PlanBadgeButton, PlanDot, usePlan, usePlanName } from './plan-badge';

/**
 * Who is signed in, and the way out — the sidebar footer's last row.
 *
 * Sign out sits behind the avatar, because a rail 60px wide has no room for a text
 * button and an always-visible sign-out is not what a signed-in surface should
 * emphasise. Account is beside it: Settings in the footer leads to preferences, and
 * this is the one place in the frame that still names the account.
 *
 * **`DropdownMenuLabel` keeps its default treatment.** The project's pattern for a
 * tiny caption is `text-label tracking-wide uppercase`, and it is the wrong answer
 * here: what this label carries is an email address, not a section name, and
 * uppercasing an address makes it harder to read and slightly wrong.
 *
 * **Loading renders the same shape, not nothing**, or the footer would drop out and
 * back in on every load.
 *
 * `detail` is drawn under the name — the sidebar passes the credit line. A slot rather
 * than a fetch in here, so the menu stays about identity.
 *
 * **The plan pill is a sibling of the trigger, not inside it.** It opens Settings ›
 * Billing on its own, and a button inside the trigger button is invalid HTML that
 * screen readers flatten. So the row is two layers in one grid cell: the trigger
 * underneath (avatar, chevron, and the whole row as its hit area and hover) and the
 * name, pill and credit line above it with `pointer-events-none`, which the pill alone
 * turns back on. Clicks anywhere but the pill fall through to the trigger. The text is
 * outside the button, so it reads as text beside it; the trigger's name carries the
 * plan, which is all the rail has once the text layer is hidden there.
 *
 * **Account and Billing open the Settings dialog** on their tab, over the current page.
 * The dialog opens once the menu has finished closing and handed focus back to its
 * trigger, so closing Settings returns focus here rather than to nowhere.
 *
 * The sign-out itself lives in `lib/sign-out.ts`, shared with Settings › Account, the More
 * sheet and the expired-token recovery path. This is a shortcut to that action, not a
 * second one. Renders a `SidebarMenuItem`; the caller supplies the `SidebarMenu`.
 */
export function SessionMenu({ detail }: { detail?: React.ReactNode }) {
  const identity = useSessionIdentity();
  const t = useTranslate();
  const trigger = useRef<HTMLButtonElement>(null);
  // The tab an item asked for, opened by `onCloseAutoFocus` below.
  const pendingTab = useRef<SettingsTabId | null>(null);
  const plan = usePlan();
  const planName = usePlanName();

  if (identity.status === 'loading') {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" disabled aria-busy="true">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  if (identity.status !== 'authenticated') return null;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <div className="grid">
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={trigger}
              size="lg"
              aria-label={
                plan === null
                  ? t('web.chrome.accountMenu')
                  : t('web.chrome.planAccountMenu', { plan: planName(plan) })
              }
              className="col-start-1 row-start-1 h-auto min-h-12 py-2"
            >
              <span className="relative shrink-0">
                <IdentityAvatar identity={identity} />
                <PlanDot plan={plan} />
              </span>
              <ChevronsUpDown aria-hidden className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          {/* The text layer: clear of the avatar (`p-2` + 32px + `gap-2`) and the
              chevron, and hidden on the rail where only the avatar fits. Truncated
              rather than wrapped: an address long enough to wrap would push the
              footer up and change the sidebar's height on some accounts and not
              others. */}
          <span
            data-slot="session-text"
            className="text-body pointer-events-none col-start-1 row-start-1 flex min-w-0 flex-col justify-center gap-0.5 py-2 pr-8 pl-12 group-data-[collapsible=icon]:hidden"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{identity.name ?? identity.email}</span>
              <PlanBadgeButton className="pointer-events-auto" />
            </span>
            {detail}
          </span>
        </div>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-56"
          onCloseAutoFocus={(event) => {
            const tab = pendingTab.current;
            if (!tab) return;
            pendingTab.current = null;
            // Focus the trigger first, so it is what the dialog returns focus to.
            event.preventDefault();
            trigger.current?.focus();
            openSettingsDialog(tab);
          }}
        >
          <DropdownMenuLabel className="font-normal">
            <span className="text-muted-foreground block">{t('web.chrome.signedInAs')}</span>
            <span className="block truncate font-medium">{identity.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-settings-tab="account"
            onSelect={() => {
              pendingTab.current = 'account';
            }}
          >
            <User aria-hidden />
            {t('web.chrome.navAccount')}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-settings-tab="billing"
            onSelect={() => {
              pendingTab.current = 'billing';
            }}
          >
            <CreditCard aria-hidden />
            {t('web.settings.billing')}
          </DropdownMenuItem>
          <DropdownMenuItem id="sign-out" onSelect={() => void signOutOfChatofy()}>
            <LogOut aria-hidden />
            {t('common.auth.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
