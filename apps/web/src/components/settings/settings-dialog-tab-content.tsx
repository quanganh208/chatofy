'use client';

import { Lock } from 'lucide-react';
import { useConversationRunning } from '@/hooks/use-conversation-running';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { AccountTabContent } from './account-tab-content';
import { AiContextSection } from './ai-context-section';
import { AppearanceSection } from './appearance-section';
import { AudioProcessingSection } from './audio-processing-section';
import { ConversationDefaultsSection } from './conversation-defaults-section';
import { CreditsSection } from './credits-section';
import { PreferencesSyncNote, PreferencesSyncSection } from './preferences-sync-section';
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
      return (
        <div className="flex flex-col gap-6">
          <AppearanceSection />
          <PreferencesSyncSection />
        </div>
      );
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
 * What a new conversation starts with, then the microphone processors, as named
 * groups.
 *
 * ONE `useTranslateSettings` for both sections: they write the same settings, so one
 * owner is enough. The tab ends on the line saying those settings follow the account.
 *
 * While a conversation runs on the page under the dialog, the pair, voice and
 * context freeze as they do on `/translate`, and one line at the top says why — the
 * reader opened Settings to change something, and a grey control with no reason is
 * the thing they would otherwise have to work out.
 */
function TranslationTab() {
  const t = useTranslate();
  const settings = useTranslateSettings();
  const running = useConversationRunning();
  return (
    <div className="flex flex-col gap-6">
      {running ? (
        <p
          data-settings-locked
          className="text-muted-foreground text-hint flex items-start gap-2 px-1"
        >
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          {t('web.settings.lockedWhileRunning')}
        </p>
      ) : null}
      <ConversationDefaultsSection {...settings} running={running} />
      <AudioProcessingSection {...settings} />
      <PreferencesSyncNote />
    </div>
  );
}
