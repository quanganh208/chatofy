'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@chatofy/ui/react';
import { useReturnFocus } from '@/hooks/use-return-focus';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { signOutOfChatofy } from '@/lib/sign-out';
import { ChangePasswordForm } from './change-password-form';
import { SettingsSection, SettingsSectionRow } from './settings-section';

/**
 * Settings › Account (security): change the password, and leave this browser.
 *
 * **Change password is a dialog.** It is a form that interrupts — three fields and a
 * consequence — and its submit is that state's one filled control. The page itself
 * spends no accent. Success closes the dialog and says so with a toast; every
 * refusal (wrong current password, throttled, session expired) stays inline in the
 * form, where the next attempt happens.
 *
 * **Sign out asks first, in an AlertDialog**, because it ends this session. It is
 * NOT a "sign out everywhere": signing out discards this browser's cookie and leaves
 * the API token valid until it expires, and no endpoint revokes every session
 * without a password change. The sentence that is true about other devices sits on
 * the password row, where it belongs — a completed change revokes every earlier
 * token and closes open sockets, while this browser is handed a replacement session.
 *
 * Both actions are outline: one changes a credential, the other is the way out and
 * is also offered by the sidebar's avatar menu. Both call the same `signOutOfChatofy`.
 */
export function SecuritySection() {
  const t = useTranslate();
  const [changing, setChanging] = useState(false);
  // Both dialogs ignore a close (Esc, overlay, the X) while their request is in
  // flight: the outcome — a refusal inline, a failed sign-out — needs them open.
  const [changeBusy, setChangeBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // The password dialog opens from state, so it has no Trigger to give focus back to.
  const returnFocus = useReturnFocus();

  return (
    <SettingsSection title={t('web.account.security')}>
      <SettingsSectionRow
        label={t('common.auth.password')}
        note={t('web.account.changePasswordHint')}
      >
        <Button id="change-password-open" variant="outline" onClick={() => setChanging(true)}>
          {t('web.account.changePassword')}
        </Button>
      </SettingsSectionRow>
      <SettingsSectionRow label={t('web.account.thisBrowser')} note={t('web.account.signOutHint')}>
        <AlertDialog
          open={confirmingSignOut}
          onOpenChange={(next) => {
            if (!signingOut) setConfirmingSignOut(next);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button id="sign-out-account" variant="outline">
              <LogOut aria-hidden />
              {t('common.auth.signOut')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('web.settings.signOutTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('web.account.signOutHint')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={signingOut}>
                {t('web.account.changePasswordCancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                id="sign-out-confirm"
                disabled={signingOut}
                onClick={(event) => {
                  // Held open until the redirect lands, so a slow sign-out does not
                  // drop the reader back on a page that still looks signed in.
                  event.preventDefault();
                  setSigningOut(true);
                  signOutOfChatofy().catch(() => {
                    setSigningOut(false);
                    notify.error(t('web.settings.signOutFailed'), { id: 'sign-out' });
                  });
                }}
              >
                {t('common.auth.signOut')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsSectionRow>

      <Dialog
        open={changing}
        onOpenChange={(next) => {
          if (!changeBusy) setChanging(next);
        }}
      >
        <DialogContent closeLabel={t('web.chrome.close')} {...returnFocus}>
          <DialogHeader>
            <DialogTitle>{t('web.account.changePassword')}</DialogTitle>
            <DialogDescription>{t('web.account.changePasswordHint')}</DialogDescription>
          </DialogHeader>
          <ChangePasswordForm
            onCancel={() => setChanging(false)}
            onBusyChange={setChangeBusy}
            onDone={() => {
              setChanging(false);
              notify.success(t('web.account.passwordChanged'), { id: 'password-change' });
            }}
          />
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
