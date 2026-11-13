'use client';

import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { AccountTabContent } from './account-tab-content';
import { AiContextSection } from './ai-context-section';
import { AppearanceSection } from './appearance-section';
import { AudioProcessingSection } from './audio-processing-section';
import { ConversationDefaultsSection } from './conversation-defaults-section';
import { CreditsSection } from './credits-section';
import type { SettingsTabId } from './settings-tab-ids';

/**
 * What each tab of the Settings dialog renders — the existing sections, composed.
 *
 * Each tab mounts only while it is shown, and the dialog's content only while it is
 * open, so Billing's balance and usage reads and Account's profile read happen when
 * the reader opens that tab and not on every page that carries the dialog.
 */
export function SettingsTabContent({ tab }: { tab: SettingsTabId }) {
  switch (tab) {
    case 'general':
      return <AppearanceSection />;
    case 'translation':
      return <TranslationTab />;
    case 'ai-context':
      return <AiContextSection />;
    case 'account':
      return <AccountTabContent />;
    case 'billing':
      return <CreditsSection />;
  }
}

/**
 * What a new conversation starts with, then the microphone processors.
 *
 * ONE `useTranslateSettings` for both sections: each owner holds a copy of the whole
 * stored object and writes all of it, so two owners in one tab would each overwrite
 * the other's change.
 */
function TranslationTab() {
  const settings = useTranslateSettings();
  return (
    <div className="flex flex-col gap-8">
      <ConversationDefaultsSection {...settings} />
      <AudioProcessingSection {...settings} />
    </div>
  );
}
