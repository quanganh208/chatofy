import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { settingsSection, type SettingsSectionId } from './settings-sections';

/**
 * The browser tab for a settings page: "Appearance · Settings · Chatofy".
 *
 * Server-only (it awaits the locale cookie through `getT`), which is why it is not in
 * `settings-sections.ts`: that list is read by client components too.
 */
export async function settingsMetadata(id: SettingsSectionId): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.settings.metaTitle', { section: t(settingsSection(id).labelKey) }) };
}
