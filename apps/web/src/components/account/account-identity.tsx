'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiClientError } from '@chatofy/api-client';
import { Avatar, AvatarFallback, AvatarImage, Button, Skeleton } from '@chatofy/ui/react';
import { deleteAvatar, uploadAvatar } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { AvatarResizeError, resizeAvatar } from '@/lib/resize-avatar';
import type { MessageKey } from '@chatofy/i18n';

/**
 * Who this account is: the photo, the name, the address, and when it started.
 *
 * **This is the page heading, not a labelled list.** Identity used to be three
 * `justify-between` rows — "Name" at one end of half a metre of nothing and the
 * name at the other, three times — which reads as a table rather than as a
 * person. It is now one cluster that answers "who is this" in one glance, so the
 * "Identity" eyebrow goes too: a caption naming the group is redundant when the
 * group IS the top of the page.
 *
 * **Its own file rather than part of `account-screen.tsx`.** A hidden file input,
 * resize wiring and four distinct error states are enough on their own; folding
 * them into the screen would push it past the 200-line threshold `CLAUDE.md` sets.
 *
 * **No accent control.** `/account` has ZERO `bg-primary` controls and stays that
 * way deliberately — the rule allows one per screen, and neither changing nor
 * removing a photo is the thing this screen is for.
 *
 * **Remove is hidden when there is no `avatarUrl`.** Note the one state that cannot
 * represent: `avatarUrl` is ALSO null when the row has a key but the server's public
 * origin is unset, which hides Remove for an account that does have a photo. Reaching
 * it means configuring an environment downward after an upload — the R2 variables are
 * all-or-nothing, so an environment that never had the base could never have accepted
 * the upload in the first place. Restoring the variable restores the control, and the
 * endpoint works throughout. Documented rather than solved with a second contract
 * field for a state nobody can reach forwards.
 *
 * **`memberSince` is a subline, and it is the only thing here that waits.** Name and
 * email come from the session cookie and paint immediately; the join date comes from
 * `GET /auth/me`. Its line reserves its own height, so the answer arriving does not
 * shove the sections below it down the page — which is what holding the whole block
 * back until the round trip finished used to do.
 */
export function AccountIdentity({
  name,
  email,
  avatarUrl,
  sessionImage,
  memberSince,
}: {
  name?: string | null;
  email?: string | null;
  /** `undefined` until `GET /auth/me` answers, and if it never does. */
  avatarUrl?: string | null;
  /**
   * The photo the session cookie already carries.
   *
   * The fallback for as long as `avatarUrl` is unknown — which is the first
   * paint, and forever if the profile lookup failed. Without it a failed lookup
   * renders initials for an account that has a photo and hides Remove, so the
   * reader cannot act on something they can see is there; and on the happy path
   * Remove POPS IN when the round trip lands, which in a wrapping row can add a
   * line and shove the sections below — the jump this header exists to remove.
   */
  sessionImage?: string | null;
  /**
   * The rendered join date: `undefined` while the lookup is in flight, `null` when
   * it failed. Two absences, because they say different things and the line reads
   * differently for each — a skeleton is "coming", a sentence is "did not arrive".
   */
  memberSince?: string | null;
}) {
  const t = useTranslate();
  const { update } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);

  // The prop is the truth until this browser changes the photo, and then the local
  // value is. `undefined` is the sentinel for "no local change yet" rather than a
  // possible photo state — an upload resolves to a string and a removal to `null`,
  // so neither can be confused with it. Seeding `useState` from the prop would miss
  // the value entirely, because this now renders BEFORE `GET /auth/me` answers.
  const [changed, setChanged] = useState<string | null>();
  const current =
    changed !== undefined ? changed : avatarUrl !== undefined ? avatarUrl : (sessionImage ?? null);
  const [error, setError] = useState<MessageKey>();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(undefined);
    let saved = false;
    try {
      setChanged(await work());
      saved = true;
      // Tells the sidebar something changed. `auth.ts` ignores what we'd send
      // and re-reads the value from the API, so there is nothing to pass here.
      //
      // Deliberately NOT allowed to fail the save. By this line the API has
      // already accepted the change and the new image is on screen, so
      // reporting "nothing was changed" because a session refresh failed would
      // be a false statement about state the user can see — the mirror of the
      // false confirmation the removal path refuses to give. The worst case is
      // a stale sidebar until the next navigation, and the URL is content
      // hashed, so a stale value still points at a valid object.
      await update();
    } catch (err) {
      // The previous image is deliberately left on screen: a failed change has
      // changed nothing, and blanking it would claim otherwise.
      if (!saved) setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the SAME file again still fires a change event.
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      const image = await resizeAvatar(file);
      return (await uploadAvatar({ image })).avatarUrl;
    });
  };

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="lg">
          <AvatarImage src={current ?? undefined} alt="" />
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The name IS the page title. The topbar says "Account", which names the
              route; this names the account. */}
          <h2 className="text-heading font-semibold tracking-tight">
            {name || t('web.account.nameUnset')}
          </h2>
          <p className="text-prose text-body break-all">{email ?? ''}</p>
          {/* The height is held whether or not the answer has arrived, so the
              sections below do not jump when it does. */}
          <p className="text-muted-foreground text-hint flex min-h-5 items-center gap-1.5">
            {memberSince === undefined ? (
              <Skeleton className="h-3 w-40" />
            ) : memberSince === null ? (
              t('web.account.loadFailed')
            ) : (
              <>
                <span className="font-semibold">{t('web.account.memberSince')}</span>
                {memberSince}
              </>
            )}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPicked}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {t('web.account.avatarChange')}
          </Button>
          {current !== null && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(async () => (await deleteAvatar()).avatarUrl)}
            >
              {t('web.account.avatarRemove')}
            </Button>
          )}
        </div>
      </div>

      {error !== undefined && (
        <p role="alert" className="text-hint text-destructive max-w-prose">
          {t(error)}
        </p>
      )}
      <p className="text-hint text-muted-foreground max-w-prose">{t('web.account.avatarHint')}</p>
    </header>
  );
}

/**
 * Which of the four messages this failure earns.
 *
 * Four rather than one, because the next step differs: pick another file, pick a
 * smaller one, retry, or tell whoever runs the server.
 *
 * The API's own message is deliberately NOT rendered. It survives the exception
 * filter — that is why storage failures are 409 and not 503 — but it is English
 * only, and this app is read in Vietnamese too. So the status is what is mapped,
 * and `avatarUnavailable` is worded to be true of BOTH 409s the API can send
 * (storage unconfigured, and storage unreachable), which share the CONFLICT code
 * and cannot be told apart here. The API's message is still the diagnosable one,
 * in the log and for any client that wants it.
 */
function messageFor(err: unknown): MessageKey {
  if (err instanceof AvatarResizeError) {
    // `decode-failed` joins `not-an-image`: the file claimed an image type and
    // the browser could not decode it, so "try again" would send the user back
    // at the same unusable file. Choosing another one is the action that helps.
    return err.reason === 'encode-failed'
      ? 'web.account.avatarFailed'
      : 'web.account.avatarNotAnImage';
  }
  if (err instanceof ApiClientError) {
    if (err.status === 409) return 'web.account.avatarUnavailable';
    if (err.status === 400) return 'web.account.avatarTooLarge';
  }
  return 'web.account.avatarFailed';
}

/** Same two-letter rule the sidebar uses — see `session-menu.tsx` for the why. */
function initials(name?: string | null, email?: string | null): string {
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
