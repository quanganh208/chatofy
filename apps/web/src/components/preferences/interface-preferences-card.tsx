'use client';

import { Card, CardContent } from '@chatofy/ui/react';
import { CardEyebrow } from '@/components/layout/card-eyebrow';
import { ConnectedThemeToggle } from '@/components/layout/theme-toggle-connected';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { useTranslate } from '@/i18n/provider';

/**
 * How the app looks, which today means one control.
 *
 * **The language row is here now that it does something.** It was deliberately absent
 * while there was only one locale to choose — a disabled control invites you to work
 * out how to enable it, which is time spent on a question with no answer.
 *
 * It is the same `LocaleSwitcher` the chrome renders, which matters for a reason
 * beyond reuse: signed in, switching also writes `User.locale`, the language the four
 * auth emails are composed in. One control, one choice, both surfaces — rather than a
 * separate "mail language" a user has to reconcile with the one they can see.
 *
 * The theme control is the same `ThemeToggle` the topbar renders. Two mounts of one
 * controlled component, both reading and writing the same storage key through
 * `lib/theme.ts`, so changing it here moves the one in the chrome on the next paint.
 */
export function InterfacePreferencesCard() {
  const t = useTranslate();

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <CardEyebrow>{t('web.preferences.interface')}</CardEyebrow>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <span className="text-body text-prose">{t('common.language.label')}</span>
          <LocaleSwitcher />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <span className="text-body text-prose">{t('common.theme.label')}</span>
          <ConnectedThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}
