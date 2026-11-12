import type { Metadata } from 'next';
import { SecuritySection } from '@/components/settings/security-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('security');
}

/** Password and this browser's session. Session-gated by `proxy.ts`. */
export default function SettingsSecurityPage() {
  return (
    <SettingsPage section="security">
      <SecuritySection />
    </SettingsPage>
  );
}
