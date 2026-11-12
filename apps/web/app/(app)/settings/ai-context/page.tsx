import type { Metadata } from 'next';
import { AiContextSection } from '@/components/settings/ai-context-section';
import { settingsMetadata } from '@/components/settings/settings-metadata';
import { SettingsPage } from '@/components/settings/settings-page';

export function generateMetadata(): Promise<Metadata> {
  return settingsMetadata('ai-context');
}

/** The AI context library. Session-gated by `proxy.ts`. */
export default function SettingsAiContextPage() {
  return (
    <SettingsPage section="ai-context">
      <AiContextSection />
    </SettingsPage>
  );
}
