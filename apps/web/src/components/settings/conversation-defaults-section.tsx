'use client';

import {
  IDENTIFIABLE_LANGUAGES,
  LANGUAGE_CODES,
  type LanguagePair,
  type SessionLanguagePair,
} from '@chatofy/types';
import { LanguagePairPicker, Separator, Skeleton } from '@chatofy/ui/react';
import { SettingsSection, SettingsSectionRow } from './settings-section';
import { ContextPicker } from '@/components/translate/context-picker';
import { VoiceSettingsPanel } from '@/components/translate/voice-settings-panel';
import { DisplaySettingsPanel } from '@/components/translate/display-settings-panel';
import type { MessageKey } from '@chatofy/i18n';
import { useTranslateSettings, type UseTranslateSettings } from '@/hooks/use-translate-settings';
import {
  canAutoDetectInto,
  pairPatchFor,
  representablePair,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { useTranslationContexts } from '@/hooks/use-translation-contexts';
import { useTranslate } from '@/i18n/provider';
import { languagePairLabels, languageNamer } from '@/i18n/language-pair-labels';
import { useSettingSaver } from './use-setting-saver';

/** What a toast calls each display setting. */
const DISPLAY_LABEL = {
  speakerLabels: 'web.translate.speakerLabels',
  translationOnly: 'web.translate.translationOnly',
  freeScroll: 'web.translate.freeScroll',
  displayMode: 'web.translate.displayMode',
  paneLayout: 'web.translate.paneLayout',
  textSize: 'web.translate.textSize',
} as const satisfies Partial<Record<keyof TranslateSettings, MessageKey>>;

/** Settings › Defaults: the page's one owner of the stored translate settings. */
export function DefaultsSettings() {
  return <ConversationDefaultsSection {...useTranslateSettings()} />;
}

/**
 * Where a new conversation starts from.
 *
 * **One component, two mounts — not two components.** The voice and display panels
 * supply no surface of their own, so the popover on `/translate` gives them
 * `PopoverContent` and this page gives them the page ground. There is one settings
 * object in storage (`chatofy.translate-settings`), so a "defaults" copy and a "live"
 * copy would be a distinction the storage cannot make.
 *
 * `running={false}`, and that is the honest difference between the two mounts. The
 * pair and voice ride `client.session.start` and cannot be changed inside a
 * conversation, so the popover disables them; here there is no conversation, so they
 * are editable.
 *
 * The rule is one `useTranslateSettings` call site per PAGE: `DefaultsSettings` is
 * this page's. A settings summary in a layout or in the chrome would break that.
 *
 * **Every change confirms with a toast that can undo it**, one toast per setting
 * (see `use-setting-saver.ts`). A voice is undone per language, so undoing English
 * leaves a Vietnamese voice changed since then alone.
 */
export function ConversationDefaultsSection({
  settings,
  ready,
  set,
  current,
}: Pick<UseTranslateSettings, 'settings' | 'ready' | 'set' | 'current'>) {
  const t = useTranslate();
  const { contexts, status } = useTranslationContexts();
  const nameLanguage = languageNamer(t);
  const save = useSettingSaver<TranslateSettings>(set, current);

  return (
    <SettingsSection>
      {/* Not rendered against the defaults and corrected a frame later: every row
          here is a stored value, so a first paint at 1× and 100% for someone who
          set 1.5× and 40% is the panel visibly changing its own mind. Same reason
          `/translate` waits, and the same shape reserved so nothing below moves. */}
      {ready ? (
        <div className="flex flex-col gap-5">
          {/* The pairs are a setting HERE and nowhere else. `/translate` and
              `/translate/two-way` name theirs in permanent panel headers with the swap
              between them, which is a better answer than a row in a popover; this
              page has no such headers, and the pair a new conversation starts in is
              what it is for. One row per page, each headed by the page's own name,
              because each page keeps its own pair. */}
          {/* Auto-detect, on the same rule as the `/translate` source control: one
              setting, so the two must offer the same values. */}
          <LanguagePairPicker<SessionLanguagePair>
            value={settings.languagePair}
            onChange={(languagePair) =>
              save('languagePair', t('web.settings.oneWayPair'), {
                languagePair: representablePair(languagePair),
              })
            }
            labels={{ ...languagePairLabels(t), pair: t('web.chrome.navTranslate') }}
            nameLanguage={languageNamer(t)}
            detectOption={
              canAutoDetectInto(settings.languagePair.target)
                ? { label: t('web.translate.autoDetect') }
                : undefined
            }
          />
          {/* The `/translate/two-way` pair: no Auto-detect, and the languages its turn
              identification cannot tell apart listed but not pickable, as there. */}
          <LanguagePairPicker<LanguagePair>
            value={settings.twoWayPair}
            onChange={(pair) =>
              save('twoWayPair', t('web.settings.twoWayPair'), pairPatchFor('two-way', pair))
            }
            labels={{ ...languagePairLabels(t), pair: t('web.chrome.navTranslateTwoWay') }}
            nameLanguage={languageNamer(t)}
            unavailable={{
              codes: LANGUAGE_CODES.filter((code) => !IDENTIFIABLE_LANGUAGES.includes(code)),
              reason: t('web.translate.twoWayLanguageUnavailable'),
            }}
          />

          {/* Which context a NEW conversation starts under, beside the pair
              and the voice it starts with. `running={false}` like everything else
              on this page — there is no conversation here to be fixed by. The
              picker renders nothing at all when the account has authored none —
              or the list is still loading, or failed to — so the ROW around it is
              gated on the same condition: `SettingsSectionRow` draws its label and
              border-b unconditionally, and rendering it over an empty picker put
              a labelled row on every screen with nothing under it. `showLabel`
              is off because this row already draws the name; the picker still
              carries it for assistive tech, `sr-only`. */}
          {status === 'ready' && contexts.length > 0 ? (
            <SettingsSectionRow label={t('web.translate.context')} block>
              <ContextPicker
                contexts={contexts}
                status={status}
                value={settings.contextId}
                running={false}
                showLabel={false}
                onChange={(contextId) =>
                  save('contextId', t('web.translate.context'), { contextId })
                }
              />
            </SettingsSectionRow>
          ) : null}

          {/* One per registry language: each language keeps its own voice, and a
              one-way conversation may translate into any of them. Named by the
              language, so the reader sets the voice of a language rather than of
              a slot. `running={false}`: no conversation here to be fixed by. The
              volume callback is a no-op — nothing is playing on this page, and
              the value still lands through `onChange`. */}
          {LANGUAGE_CODES.map((language) => (
            <SettingsSectionRow
              key={language}
              label={t('web.translate.voiceSettingsFor', { language: nameLanguage(language) })}
              block
            >
              <div className="w-full" data-voice-language={language}>
                <VoiceSettingsPanel
                  settings={settings}
                  language={language}
                  running={false}
                  onChange={(patch) =>
                    save(
                      `voice-${language}`,
                      t('web.translate.voiceSettingsFor', { language: nameLanguage(language) }),
                      patch,
                      (before, now) => ({
                        voiceByLanguage: {
                          ...now.voiceByLanguage,
                          [language]: before.voiceByLanguage[language],
                        },
                      }),
                    )
                  }
                  onVolumeChange={() => {}}
                />
              </div>
            </SettingsSectionRow>
          ))}

          <Separator />

          {/* How a new conversation's transcript is laid out is a default like the
              rest, read from the same storage key, so it shares this page's one
              `useTranslateSettings`. */}
          <DisplaySettingsPanel
            settings={settings}
            onChange={(patch) => {
              const key = Object.keys(patch)[0];
              if (!key) return;
              const label: MessageKey =
                key in DISPLAY_LABEL
                  ? DISPLAY_LABEL[key as keyof typeof DISPLAY_LABEL]
                  : 'web.translate.displaySettings';
              save(key, t(label), patch);
            }}
          />
        </div>
      ) : (
        <Skeleton aria-hidden className="h-72" />
      )}
    </SettingsSection>
  );
}
