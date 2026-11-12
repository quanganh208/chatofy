'use client';

import { useSyncExternalStore } from 'react';
import { Toaster } from '@chatofy/ui/react';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { useTranslate } from '@/i18n/provider';

/**
 * The one toast host for the signed-in app; `lib/notify.ts` is how a screen speaks
 * through it.
 *
 * Bottom-right from 768px, where it sits away from the topbar's actions and the
 * translator's dock is centred. Top-centre below, because the bottom of a phone is the
 * tab bar and the thumb. Four seconds by default; `notify.error` overrides that to
 * stay until dismissed.
 */
const DESKTOP = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(DESKTOP);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

const isDesktop = () => window.matchMedia?.(DESKTOP).matches ?? true;

export function AppToaster() {
  const t = useTranslate();
  const scheme = useResolvedColorScheme();
  const desktop = useSyncExternalStore(subscribe, isDesktop, () => true);

  return (
    <Toaster
      theme={scheme}
      position={desktop ? 'bottom-right' : 'top-center'}
      duration={4000}
      containerAriaLabel={t('web.chrome.notifications')}
      toastOptions={{ closeButtonAriaLabel: t('web.chrome.dismiss') }}
    />
  );
}
