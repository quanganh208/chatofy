'use client';

import Link from 'next/link';
import { ChevronsUpDown, LogOut, User } from 'lucide-react';
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
import { IdentityAvatar, useSessionIdentity } from './session-identity';

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
 * The sign-out itself lives in `lib/sign-out.ts`, shared with `/settings/security`, the More
 * sheet and the expired-token recovery path. This is a shortcut to that action, not a
 * second one. Renders a `SidebarMenuItem`; the caller supplies the `SidebarMenu`.
 */
export function SessionMenu({ detail }: { detail?: React.ReactNode }) {
  const identity = useSessionIdentity();
  const t = useTranslate();

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
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            aria-label={t('web.chrome.accountMenu')}
            className="h-auto min-h-12 py-2"
          >
            <IdentityAvatar identity={identity} />
            {/* Truncated rather than wrapped: an address long enough to wrap would
                push the footer up and change the sidebar's height on some accounts
                and not others. */}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
              <span className="truncate font-medium">{identity.name ?? identity.email}</span>
              {detail}
            </span>
            <ChevronsUpDown aria-hidden className="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="text-muted-foreground block">{t('web.chrome.signedInAs')}</span>
            <span className="block truncate font-medium">{identity.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile">
              <User aria-hidden />
              {t('web.chrome.navAccount')}
            </Link>
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
