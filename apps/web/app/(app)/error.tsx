'use client';

import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * A failure inside the product surface.
 *
 * Scoped to the group so the chrome around it survives — once this group has a
 * sidebar, a thrown route must not take the navigation down with it and leave the
 * reader on a blank page with no way out.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslate();

  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-heading font-display font-normal tracking-tight">
        {t('web.error.title')}
      </h1>
      <p className="text-prose text-body max-w-prose">{t('web.error.appBody')}</p>
      <Button onClick={reset}>{t('web.error.retry')}</Button>
    </div>
  );
}
