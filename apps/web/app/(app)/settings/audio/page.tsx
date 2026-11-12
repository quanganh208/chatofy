import type { Metadata } from 'next';
import { AudioSettings } from '@/components/settings/audio-processing-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('audio');
}

/** The microphone processors. Session-gated by `proxy.ts`. */
export default function SettingsAudioPage() {
  return (
    <SettingsPage section="audio">
      <AudioSettings />
    </SettingsPage>
  );
}
