'use client';

import type { ReactNode } from 'react';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { AudioProcessingSection } from './audio-processing-section';
import { ConversationDefaultsSection } from './conversation-defaults-section';

/**
 * The one owner of the stored translate settings on `/preferences`.
 *
 * `useTranslateSettings` is per-instance state with a debounced save of the whole
 * object, so two instances on one page would each write back their own copy and undo
 * the other's change. Both sections that read the store take it from here instead.
 *
 * `children` sits between them, which is where the page puts the AI Context library.
 */
export function TranslateSettingsSections({ children }: { children?: ReactNode }) {
  const { settings, ready, set } = useTranslateSettings();
  return (
    <>
      <AudioProcessingSection settings={settings} ready={ready} set={set} />
      {children}
      <ConversationDefaultsSection settings={settings} ready={ready} set={set} />
    </>
  );
}
