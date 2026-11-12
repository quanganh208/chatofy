'use client';

import { useSession } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from '@chatofy/ui/react';

/**
 * Who is signed in, read once for every place the chrome shows it: the sidebar
 * footer's menu and the mobile More sheet.
 *
 * **The avatar image comes from the session, and only ever from the API.** `auth.ts`
 * copies `avatarUrl` off the API's own response into `user.image` on every sign-in —
 * unconditionally on the Google path, so a null overwrites the `lh3.googleusercontent.com`
 * URL Auth.js's Google provider puts there by default. That matters here: `img-src` in
 * `next.config.ts` names the R2 origin and nothing else, so a surviving Google URL
 * would be requested on every authenticated page and blocked.
 *
 * Radix shows `AvatarFallback` on its own when the image is absent OR fails to load,
 * so the initials path needs no branching and a blocked URL degrades to initials
 * rather than a broken-image icon.
 */
export interface SessionIdentity {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  name?: string;
  email?: string;
  image?: string;
}

export function useSessionIdentity(): SessionIdentity {
  const { data, status } = useSession();
  if (status !== 'authenticated') return { status };
  return {
    status,
    name: data.user?.name ?? undefined,
    email: data.user?.email ?? undefined,
    image: data.user?.image ?? undefined,
  };
}

/** `alt=""`: the name always sits beside it, so announcing it again is noise. */
export function IdentityAvatar({ identity }: { identity: SessionIdentity }) {
  return (
    <Avatar>
      <AvatarImage src={identity.image} alt="" />
      <AvatarFallback>{initials(identity.name, identity.email)}</AvatarFallback>
    </Avatar>
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
