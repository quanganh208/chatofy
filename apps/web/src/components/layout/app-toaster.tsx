'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Toaster } from '@chatofy/ui/react';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { useTranslate } from '@/i18n/provider';
import { routeToastsToSettings, SETTINGS_TOASTER_ID } from '@/lib/notify';

/**
 * The signed-in app's toast hosts; `lib/notify.ts` is how a screen speaks through them.
 *
 * **The page's host** (`host="page"`, mounted once by `app/(app)/layout.tsx`):
 * bottom-right from 768px, where it sits away from the topbar's actions and the
 * translator's dock is centred; top-centre below, because the bottom of a phone is
 * the tab bar and the thumb.
 *
 * **The Settings host** (`host="settings"`, mounted inside the Settings dialog while
 * it is open): a modal traps focus, so a toast outside it — "Saved" with Undo — could
 * not be reached by Tab or Alt+T. Inside the dialog it is in the trap. It has its own
 * sonner id and `notify` routes to it while it is mounted, so each toast lives in
 * exactly one host and never moves between them. Bottom-right of the window from
 * 768px, like the page's; bottom-centre on a phone, where the dialog fills the screen
 * and its back button and ✕ are at the top.
 *
 * Four seconds by default; `notify.error` overrides that to stay until dismissed.
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
  const scheme = useResolvedColorScheme();
  const desktop = useSyncExternalStore(subscribe, isDesktop, () => true);
  const inSettings = host === 'settings';

  useEffect(() => {
    if (!inSettings) return;
    routeToastsToSettings(true);
    return () => routeToastsToSettings(false);
  }, [inSettings]);

  return (
    <Toaster
      id={inSettings ? SETTINGS_TOASTER_ID : undefined}
      theme={scheme}
      position={desktop ? 'bottom-right' : inSettings ? 'bottom-center' : 'top-center'}
      // Clear of the home indicator on a notched phone.
      mobileOffset={inSettings ? { bottom: 'calc(16px + env(safe-area-inset-bottom))' } : undefined}
      duration={4000}
      containerAriaLabel={t('web.chrome.notifications')}
      toastOptions={{ closeButtonAriaLabel: t('web.chrome.dismiss') }}
    />
  );
}
