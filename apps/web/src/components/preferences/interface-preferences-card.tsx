'use client';

import { Card, CardContent } from '@chatofy/ui/react';
import { CardEyebrow } from '@/components/dashboard/card-eyebrow';
import { ConnectedThemeToggle } from '@/components/layout/theme-toggle-connected';
import { useTranslate } from '@/i18n/provider';

/**
 * How the app looks, which today means one control.
 *
 * **The language switcher belongs here and is deliberately absent.** It becomes real in
 * Phase 10, when there is a second locale to switch to. Rendering it disabled until then
 * would put a control on the page whose only honest label is "not yet" — and a disabled
 * control invites you to work out how to enable it, which is time spent on a question
 * with no answer. A row that is not there explains itself.
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
          <span className="text-body text-prose">{t('common.theme.label')}</span>
          <ConnectedThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}
