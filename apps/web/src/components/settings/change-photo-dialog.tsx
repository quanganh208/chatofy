'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiClientError } from '@chatofy/api-client';
import type { MessageKey } from '@chatofy/i18n';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chatofy/ui/react';
import { deleteAvatar, uploadAvatar } from '@/clients/api-client';
import { useReturnFocus } from '@/hooks/use-return-focus';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { AvatarResizeError, resizeAvatar } from '@/lib/resize-avatar';

/** What a finished change did: the new photo URL (or none), and which way it went. */
export interface PhotoChange {
  avatarUrl: string | null;
  kind: 'updated' | 'removed';
}

/**
 * Change photo, as a dialog: the photo as it is, a way to pick another, a way to
 * remove it.
 *
 * **Outcomes are toasts, and the dialog closes on success.** A failure is split by
 * what the reader can do about it. A file that is not an image, or is too large, is
 * about THIS pick and is said inline under the photo, where the next pick happens. A
 * failure of the server (storage down or unconfigured, the request failed) is said
 * with an error toast that offers Retry, because the same file may well go through
 * the second time.
 *
 * The previous image stays on screen through a failure: a failed change has changed
 * nothing, and blanking it would claim otherwise.
 *
 * "Choose an image" is the dialog's one filled control; Remove is ghost.
 */
export function ChangePhotoDialog({
  open,
  onOpenChange,
  current,
  initials,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string | null;
  initials: string;
  onChanged: (change: PhotoChange) => void;
}) {
  const t = useTranslate();
  // Opened from state, so there is no Trigger for Radix to give focus back to.
  const returnFocus = useReturnFocus();
  const { update } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [inlineError, setInlineError] = useState<MessageKey>();
  const [busy, setBusy] = useState(false);

  const run = async (kind: PhotoChange['kind'], work: () => Promise<string | null>) => {
    setBusy(true);
    setInlineError(undefined);
    notify.dismiss('photo-change');
    let avatarUrl: string | null;
    try {
      avatarUrl = await work();
    } catch (err) {
      const key = messageFor(err);
      if (key === 'web.account.avatarNotAnImage' || key === 'web.account.avatarTooLarge') {
        setInlineError(key);
      } else {
        notify.error(t(key), { id: 'photo-change', retry: () => void run(kind, work) });
      }
      setBusy(false);
      return;
    }
    onChanged({ avatarUrl, kind });
    onOpenChange(false);
    setBusy(false);
    notify.success(
      t(kind === 'updated' ? 'web.settings.photoUpdated' : 'web.settings.photoRemoved'),
      { id: 'photo-change' },
    );
    // Tells the sidebar something changed. `auth.ts` ignores what we send and re-reads
    // the value from the API, so the body is empty on purpose.
    //
    // AN ARGUMENT IS REQUIRED: next-auth POSTs only when `update` is called with
    // something, and only the POST carries `trigger: 'update'` into the callback that
    // re-reads the avatar. A bare `update()` is a GET and the sidebar kept the old image.
    //
    // Deliberately NOT allowed to fail the save: the API has already accepted the
    // change and the new image is on screen. The worst case is a stale sidebar until
    // the next navigation.
    await update({}).catch(() => {});
  };

  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the SAME file again still fires a change event.
    event.target.value = '';
    if (!file) return;
    void run('updated', async () => {
      const image = await resizeAvatar(file);
      return (await uploadAvatar({ image })).avatarUrl;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setInlineError(undefined);
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t('web.chrome.close')} className="sm:max-w-md" {...returnFocus}>
        <DialogHeader>
          <DialogTitle>{t('web.account.avatarChange')}</DialogTitle>
          <DialogDescription>{t('web.account.avatarHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <Avatar className="size-24">
            <AvatarImage src={current ?? undefined} alt="" />
            <AvatarFallback className="text-heading">{initials}</AvatarFallback>
          </Avatar>
          {inlineError !== undefined ? (
            <p role="alert" className="text-hint text-destructive max-w-prose text-center">
              {t(inlineError)}
            </p>
          ) : null}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPicked}
          data-photo-input
        />
        <DialogFooter>
          {current !== null ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run('removed', async () => (await deleteAvatar()).avatarUrl)}
            >
              {t('web.account.avatarRemove')}
            </Button>
          ) : null}
          <Button id="photo-choose" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('web.settings.photoChoose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Which of the four messages this failure earns.
 *
 * Four rather than one, because the next step differs: pick another file, pick a
 * smaller one, retry, or tell whoever runs the server. The API's own message is
 * English only and is never rendered; the status is what is mapped, and
 * `avatarUnavailable` is worded to be true of BOTH 409s the API can send (storage
 * unconfigured, and storage unreachable).
 */
function messageFor(err: unknown): MessageKey {
  if (err instanceof AvatarResizeError) {
    // `decode-failed` joins `not-an-image`: the file claimed an image type and the
    // browser could not decode it, so choosing another one is the action that helps.
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
