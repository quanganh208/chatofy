'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiClientError } from '@chatofy/api-client';
import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent } from '@chatofy/ui/react';
import { deleteAvatar, uploadAvatar } from '@/clients/api-client';
import { CardEyebrow } from '@/components/dashboard/card-eyebrow';
import { useTranslate } from '@/i18n/provider';
import { AvatarResizeError, resizeAvatar } from '@/lib/resize-avatar';
import type { MessageKey } from '@chatofy/i18n';

/**
 * The account's photo, and the two things you can do to it.
 *
 * **Its own file rather than a third `<Card>` in `account-card.tsx`.** That file is
 * already ~140 lines with two cards; an avatar row, a hidden file input, resize
 * wiring and four error states push it past the 200-line threshold `CLAUDE.md` sets.
 *
 * **Both buttons are `variant="outline"`.** `/account` currently has ZERO `bg-primary`
 * controls and stays that way deliberately — `development-rules.md` allows one accent
 * control per app screen, and neither changing nor removing a photo is the thing this
 * screen is for.
 *
 * **Remove is hidden when there is no `avatarUrl`.** Note the one state that cannot
 * represent: `avatarUrl` is ALSO null when the row has a key but the server's public
 * origin is unset, which hides Remove for an account that does have a photo. Reaching
 * it means configuring an environment downward after an upload — the R2 variables are
 * all-or-nothing, so an environment that never had the base could never have accepted
 * the upload in the first place. Restoring the variable restores the control, and the
 * endpoint works throughout. Documented rather than solved with a second contract
 * field for a state nobody can reach forwards.
 */
export function AccountAvatarCard({
  name,
  email,
  avatarUrl,
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl: string | null;
}) {
  const t = useTranslate();
  const { update } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);

  // Seeded from the prop and then owned locally, so a change shows immediately
  // rather than after the session round trip.
  const [current, setCurrent] = useState(avatarUrl);
  const [error, setError] = useState<MessageKey>();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(undefined);
    try {
      setCurrent(await work());
      // Tells the sidebar something changed. `auth.ts` ignores what we'd send
      // and re-reads the value from the API, so there is nothing to pass here.
      await update();
    } catch (err) {
      // The previous image is deliberately left on screen: a failed change has
      // changed nothing, and blanking it would claim otherwise.
      setError(messageFor(err));
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
    <Card>
      <CardContent className="flex flex-col gap-5">
        <CardEyebrow>{t('web.account.avatar')}</CardEyebrow>

        <div className="flex items-center gap-4">
          <Avatar size="lg">
            <AvatarImage src={current ?? undefined} alt="" />
            <AvatarFallback>{initials(name, email)}</AvatarFallback>
          </Avatar>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPicked}
            />
            <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              {t('web.account.avatarChange')}
            </Button>
            {current !== null && (
              <Button
                variant="outline"
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
      </CardContent>
    </Card>
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
    return err.reason === 'not-an-image'
      ? 'web.account.avatarNotAnImage'
      : 'web.account.avatarFailed';
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
