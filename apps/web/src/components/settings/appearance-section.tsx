'use client';

import { createTranslator, en, vi, zh, type Locale } from '@chatofy/i18n';
import { updateMe } from '@/clients/api-client';
import type { ThemeChange } from '@/components/layout/theme-toggle-connected';
import { LocaleSwitcher, type LocaleChange } from '@/components/layout/locale-switcher';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { SettingsSection, SettingsSectionRow } from './settings-section';
import { ThemeChoiceTiles } from './theme-choice-tiles';

const DICTIONARIES = { en, vi, zh } as const;

/**
 * Settings › General: the colour theme, as three pictures of the app, and the
 * interface language, each under its own heading.
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
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('web.settings.appearance')}>
        <SettingsSectionRow label={t('common.theme.label')} block>
          <ThemeChoiceTiles onChange={onTheme} />
        </SettingsSectionRow>
      </SettingsSection>
      <SettingsSection title={t('common.language.label')}>
        <SettingsSectionRow
          label={t('web.settings.interfaceLanguage')}
          note={t('web.settings.languageNote')}
        >
          {/* Stacked under its note on a phone, the ghost button's own padding would
              indent its text from the label's; pulled back to the label's edge. */}
          <LocaleSwitcher showValue onChange={onLocale} className="max-sm:-ml-2.5" />
        </SettingsSectionRow>
      </SettingsSection>
    </div>
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
