import type { Metadata } from 'next';
import { ProfileSettings } from '@/components/settings/profile-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('profile');
}

/** Photo, name, email, member since. Session-gated by `proxy.ts`. */
export default function SettingsProfilePage() {
  return (
    <SettingsPage section="profile">
      <ProfileSettings />
    </SettingsPage>
  );
}
