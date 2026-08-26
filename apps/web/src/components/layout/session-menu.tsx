'use client';

import { useSession } from 'next-auth/react';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';

/**
 * Who is signed in, and the way out — now the sidebar's footer.
 *
 * This was a bare email string and a Sign out button sitting in a page header. Two
 * things changed and both were forced by the sidebar. The identity moved to the
 * footer, where the mockup puts it and where it stops competing with the page title.
 * And Sign out moved behind the avatar, because a rail 60px wide has no room for a
 * text button and an always-visible sign-out is not what a signed-in surface should
 * emphasise.
 *
 * **`DropdownMenuLabel` keeps its default treatment.** The project's pattern for a
 * tiny caption is `text-label tracking-wide uppercase`, and it is the wrong answer
 * here: what this label carries is an email address, not a section name, and
 * uppercasing an address makes it harder to read and slightly wrong. The rule is
 * about captions; this is data with a caption above it.
 *
 * **Loading renders the same shape, not nothing.** The old version returned `null`
 * while the session resolved, which was invisible for a text span and would now drop
 * the sidebar footer out and back in on every load.
 *
 * There is no avatar image, so the fallback initials are the avatar rather than a
 * fallback. The session carries none (`auth.ts` copies id, email, name and the API
 * token, and nothing else), and wiring Google's `picture` later would fail silently
 * against `img-src 'self'` in `next.config.ts` — worth knowing before someone tries.
 *
 * The sign-out itself lives in `lib/sign-out.ts`, shared with `/account` and the
 * expired-token recovery path — including the note about what it does not do. This is
 * a shortcut to that action, not a second one.
 */
export function SessionMenu() {
  const { data, status } = useSession();
  const t = useTranslate();

  if (status === 'loading') {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled aria-busy="true">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (status !== 'authenticated') return null;

  const name = data.user?.name ?? undefined;
  const email = data.user?.email ?? undefined;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t('web.chrome.accountMenu')}>
              <Avatar>
                <AvatarFallback>{initials(name, email)}</AvatarFallback>
              </Avatar>
              {/* Truncated rather than wrapped: an address long enough to wrap would
                  push the footer up and change the sidebar's height on some accounts
                  and not others. */}
              <span className="min-w-0 flex-1 truncate text-left">{name ?? email}</span>
              <ChevronsUpDown aria-hidden className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="text-muted-foreground block">{t('web.chrome.signedInAs')}</span>
              <span className="block truncate font-medium">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem id="sign-out" onSelect={() => void signOutOfChatofy()}>
              <LogOut aria-hidden />
              {t('web.chrome.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Two letters for the avatar: the initials of a two-part name, else the first two
 * characters of whatever there is.
 *
 * `Array.from` rather than `slice`, because the name may be Vietnamese and a
 * precomposed character is one code point while a decomposed one is two — `slice(0, 2)`
 * would cut a diacritic off its vowel and render a lone combining mark.
 */
function initials(name?: string, email?: string): string {
  const source = (name ?? email ?? '').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  const letters =
    first !== undefined && last !== undefined && first !== last
      ? [Array.from(first)[0] ?? '', Array.from(last)[0] ?? '']
      : Array.from(source).slice(0, 2);
  return letters.join('').toUpperCase();
}
