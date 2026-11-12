import type { Metadata } from 'next';
import { DefaultsSettings } from '@/components/settings/conversation-defaults-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('defaults');
}

/** What a new conversation starts from. Session-gated by `proxy.ts`. */
export default function SettingsDefaultsPage() {
  return (
    <SettingsPage section="defaults">
      <DefaultsSettings />
    </SettingsPage>
  );
}
