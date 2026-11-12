import type { Metadata } from 'next';
import { AppearanceSection } from '@/components/settings/appearance-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('appearance');
}

/** Interface language and colour theme. Session-gated by `proxy.ts`. */
export default function SettingsAppearancePage() {
  return (
    <SettingsPage section="appearance">
      <AppearanceSection />
    </SettingsPage>
  );
}
