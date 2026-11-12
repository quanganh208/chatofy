'use client';

import { useTranslate } from '@/i18n/provider';
import { settingsSection, type SettingsSectionId } from './settings-sections';

/**
 * One settings page: its title and one-line description, then its rows.
 *
 * The title is an `h2` in the ordinary app face, not a display heading. The topbar's
 * breadcrumb already ends on the page's `<h1>` (Settings › Appearance), so this is the
 * content's own heading under it, sized like the rest of the app rather than like a
 * landing page.
 */
export function SettingsPage({
  section,
  children,
}: {
  section: SettingsSectionId;
  children: React.ReactNode;
}) {
  const t = useTranslate();
  const meta = settingsSection(section);
  return (
    <div className="flex flex-col gap-8" data-settings-page={section}>
      <header className="border-hairline flex flex-col gap-1 border-b pb-4">
        <h2 className="text-heading font-semibold tracking-tight">{t(meta.labelKey)}</h2>
        <p className="text-muted-foreground text-body max-w-[62ch]">{t(meta.descriptionKey)}</p>
      </header>
      {children}
    </div>
  );
}
