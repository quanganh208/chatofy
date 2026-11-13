'use client';

import { LANGUAGE_CODES } from '@chatofy/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@chatofy/ui/react';
import { VoiceSettingsPanel } from '@/components/translate/voice-settings-panel';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';
import { languageVoice, type TranslateSettings } from '@/lib/translate-settings';
import { SettingsSection } from './settings-section';
import { useSettingSaver } from './use-setting-saver';

/**
 * Settings › Translation › Voice: how each language is spoken, one row per
 * registry language.
 *
 * Each language keeps its own voice and a one-way conversation may translate into
 * any of them, so the rows are named by the language alone — the group heading
 * already says "Voice". Each row folds: three full voice setups open at once made
 * one box taller than the dialog, five near-identical controls deep. Folded, a row
 * still says whether that language is spoken, and the one-way target — the voice a
 * new conversation is most likely to use — starts open.
 *
 * Each language is its own single-item accordion rather than one shared root, so
 * every row is a direct child of the group box and takes its inset and hairline
 * like any other row. The panel is the same `VoiceSettingsPanel` the `/translate`
 * popover renders, so the two surfaces cannot offer different controls.
 *
 * `running` freezes everything but volume, exactly as the popover does
 * mid-conversation: the rest rides `client.session.start`. The volume callback is a
 * no-op — nothing plays inside the dialog; the value lands through `onChange`, and
 * the page underneath picks it up through the settings sync.
 *
 * A voice is undone per language, so undoing English leaves a Vietnamese voice
 * changed since then alone.
 */
export function VoiceDefaultsSection({
  settings,
  set,
  current,
  running,
}: Pick<UseTranslateSettings, 'settings' | 'set' | 'current'> & { running: boolean }) {
  const t = useTranslate();
  const nameLanguage = languageNamer(t);
  const save = useSettingSaver<TranslateSettings>(set, current);

  return (
    <SettingsSection title={t('web.settings.groupVoice')}>
      {LANGUAGE_CODES.map((language) => {
        const toastLabel = t('web.translate.voiceSettingsFor', {
          language: nameLanguage(language),
        });
        const speak = languageVoice(settings, language).speak;
        return (
          <Accordion
            key={language}
            type="single"
            collapsible
            defaultValue={language === settings.languagePair.target ? language : undefined}
          >
            <AccordionItem value={language} className="border-b-0">
              <AccordionTrigger className="min-h-12 items-center py-3 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                  <span className="truncate">{nameLanguage(language)}</span>
                  <span className="text-muted-foreground text-hint shrink-0 font-normal">
                    {`${t('web.translate.speakTranslation')}: ${t(
                      speak ? 'web.translate.speakOn' : 'web.translate.speakOff',
                    )}`}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-1 pb-5">
                <div className="w-full" data-voice-language={language}>
                  <VoiceSettingsPanel
                    settings={settings}
                    language={language}
                    running={running}
                    // The tab says why once, above every group.
                    lockNote={false}
                    onChange={(patch) =>
                      save(`voice-${language}`, toastLabel, patch, (before, now) => ({
                        voiceByLanguage: {
                          ...now.voiceByLanguage,
                          [language]: before.voiceByLanguage[language],
                        },
                      }))
                    }
                    onVolumeChange={() => {}}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        );
      })}
    </SettingsSection>
  );
}
