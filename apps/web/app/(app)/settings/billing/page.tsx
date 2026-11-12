import type { Metadata } from 'next';
import { CreditsSection } from '@/components/settings/credits-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('billing');
}

/**
 * Credits, plan, top-ups and usage. Polar's success URL lands here
 * (`?checkout=done`), directly or through the `/account` redirect.
 * Session-gated by `proxy.ts`.
 */
export default function SettingsBillingPage() {
  return (
    <SettingsPage section="billing">
      <CreditsSection />
    </SettingsPage>
  );
}
