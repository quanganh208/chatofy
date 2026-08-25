'use client';

import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/** A failure on the public surface. Public, so it says as little as the others. */
export default function MarketingError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslate();
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-heading font-semibold tracking-tight">{t('web.error.title')}</h1>
      <p className="text-prose text-body max-w-prose">{t('web.error.pageDidNotLoad')}</p>
      <Button onClick={reset}>{t('web.error.retry')}</Button>
    </div>
  );
}
