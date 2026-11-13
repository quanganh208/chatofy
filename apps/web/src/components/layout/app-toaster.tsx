'use client';

import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { Toaster } from '@chatofy/ui/react';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { useTranslate } from '@/i18n/provider';
import { readSettingsDialog } from '@/components/settings/settings-dialog-url';

/**
 * The one toast host for the signed-in app; `lib/notify.ts` is how a screen speaks
 * through it.
 *
 * Bottom-right from 768px, where it sits away from the topbar's actions and the
 * translator's dock is centred. Top-centre below, because the bottom of a phone is the
 * tab bar and the thumb. Four seconds by default; `notify.error` overrides that to
 * stay until dismissed.
 *
 * Pressable over an open modal dialog: see the `pointerEvents` note below.
 */
const DESKTOP = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(DESKTOP);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

const isDesktop = () => window.matchMedia?.(DESKTOP).matches ?? true;

export function AppToaster({ host = 'page' }: { host?: 'page' | 'settings' }) {
  const t = useTranslate();
  // While Settings is open the host moves INSIDE the dialog (`settings-dialog.tsx`
  // renders `<AppToaster host="settings" />`). A modal traps focus, so a toast outside
  // it — "Saved" with Undo, raised by a change made in Settings — could be clicked
  // but never reached by Tab or by sonner's Alt+T. Inside, it is part of the trap.
  // One host at a time, so a toast never shows twice.
  const settingsOpen = readSettingsDialog(useSearchParams()) !== undefined;
  const scheme = useResolvedColorScheme();
  const desktop = useSyncExternalStore(subscribe, isDesktop, () => true);

  if (host === 'page' && settingsOpen) return null;

  return (
    <Toaster
      theme={scheme}
      position={desktop ? 'bottom-right' : 'top-center'}
      duration={4000}
      containerAriaLabel={t('web.chrome.notifications')}
      // A modal dialog sets `pointer-events: none` on the body, and the toaster
      // inherits it — so a toast raised from inside Settings (Saved, with Undo) could
      // not be pressed while Settings was open. The dialog lets a press on the toaster
      // through (`settings/settings-dialog.tsx`); this lets the press land.
      style={{ pointerEvents: 'auto' }}
      toastOptions={{ closeButtonAriaLabel: t('web.chrome.dismiss') }}
    />
  );
}
