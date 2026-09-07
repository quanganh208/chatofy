'use client';

import { SettingsSection, SettingsSectionRow } from '@/components/layout/settings-section';
import { ConnectedThemeToggle } from '@/components/layout/theme-toggle-connected';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { useTranslate } from '@/i18n/provider';

/**
 * How the app looks, which today means two controls.
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
 *
 * **No panel.** Two rows that change how the page looks are not an object you act on
 * as a unit; the screen spends its one elevated surface on the defaults below.
 */
export function InterfacePreferencesSection() {
  const t = useTranslate();

  return (
    <SettingsSection title={t('web.preferences.interface')}>
      <SettingsSectionRow label={t('common.language.label')}>
        <LocaleSwitcher />
      </SettingsSectionRow>
      <SettingsSectionRow label={t('common.theme.label')}>
        <ConnectedThemeToggle />
      </SettingsSectionRow>
    </SettingsSection>
  );
}
