'use client';

import { createTranslator, en, vi, type Locale } from '@chatofy/i18n';
import { updateMe } from '@/clients/api-client';
import { ConnectedThemeToggle, type ThemeChange } from '@/components/layout/theme-toggle-connected';
import { LocaleSwitcher, type LocaleChange } from '@/components/layout/locale-switcher';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { SettingsSection, SettingsSectionRow } from './settings-section';

const DICTIONARIES = { en, vi } as const;

/**
 * Settings › Appearance: the interface language and the colour theme.
 *
 * These two left the topbar with the app-shell redesign and live only here now.
 *
 * It is the same `LocaleSwitcher` the marketing header renders, which matters beyond
 * reuse: signed in, switching also writes `User.locale`, the language the four auth
 * emails are composed in. One control, one choice, both surfaces.
 *
 * **Both confirm with a toast that can undo.** The language toast is written in the
 * language just chosen — the page re-renders into it a moment later, and a
 * confirmation in the language being left would be the one string on screen still in
 * it. If the account write fails, the same toast turns into an error with Retry: the
 * cookie already holds the choice for this browser, but the emails would still come
 * in the old language.
 */
export function AppearanceSection() {
  const t = useTranslate();

  const onLocale = ({ next, revert, persisted }: LocaleChange) => {
    const inNext = createTranslator(DICTIONARIES[next]);
    const id = 'setting-locale';
    const setting = inNext('common.language.label');
    notify.success(inNext('web.settings.saved', { setting }), { id, undo: revert });
    persisted.catch(() => notifyLocaleFailed(next, id, setting, inNext));
  };

  const onTheme = ({ revert }: ThemeChange) => {
    notify.success(t('web.settings.saved', { setting: t('common.theme.label') }), {
      id: 'setting-theme',
      undo: revert,
    });
  };

  return (
    <SettingsSection>
      <SettingsSectionRow label={t('common.language.label')} note={t('web.settings.languageNote')}>
        <LocaleSwitcher showValue onChange={onLocale} />
      </SettingsSectionRow>
      <SettingsSectionRow label={t('common.theme.label')}>
        <ConnectedThemeToggle onChange={onTheme} />
      </SettingsSectionRow>
    </SettingsSection>
  );
}

function notifyLocaleFailed(
  locale: Locale,
  id: string,
  setting: string,
  t: ReturnType<typeof createTranslator>,
): void {
  notify.error(t('web.settings.saveFailed', { setting }), {
    id,
    retry: () => {
      updateMe({ locale }).then(
        () => notify.success(t('web.settings.saved', { setting }), { id }),
        () => notifyLocaleFailed(locale, id, setting, t),
      );
    },
  });
}
