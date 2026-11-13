'use client';

import {
  IDENTIFIABLE_LANGUAGES,
  LANGUAGE_CODES,
  type LanguagePair,
  type SessionLanguagePair,
} from '@chatofy/types';
import { LanguagePairPicker, Skeleton } from '@chatofy/ui/react';
import { SettingsSection, SettingsSectionRow } from './settings-section';
import { ContextPicker } from '@/components/translate/context-picker';
import { DisplaySettingsPanel } from '@/components/translate/display-settings-panel';
import type { MessageKey } from '@chatofy/i18n';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
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
import { VoiceDefaultsSection } from './voice-defaults-section';

/** What a toast calls each display setting. */
const DISPLAY_LABEL = {
  speakerLabels: 'web.translate.speakerLabels',
  translationOnly: 'web.translate.translationOnly',
  freeScroll: 'web.translate.freeScroll',
  displayMode: 'web.translate.displayMode',
  paneLayout: 'web.translate.paneLayout',
  textSize: 'web.translate.textSize',
} as const satisfies Partial<Record<keyof TranslateSettings, MessageKey>>;

/**
 * Where a new conversation starts from, as named groups: Languages, Voice,
 * Default AI context and Display. The microphone group follows from
 * `audio-processing-section.tsx`.
 *
 * **One component per concern, the shared panels inside.** The voice and display
 * panels are the ones the `/translate` popovers render; they supply no surface of
 * their own, so here each sits inside a group's hairline box. There is one settings
 * object, in the account's preferences, so a "defaults" copy and a "live" copy would
 * be a distinction the store cannot make.
 *
 * **`running`** is true while a conversation runs on the page under the Settings
 * dialog. The pairs, the context and the voice ride `client.session.start` and are
 * fixed for the run, so they freeze here exactly as they do on `/translate`; the
 * display group never reaches the session and stays live.
 *
 * The rule is one `useTranslateSettings` call site per surface: the Settings dialog's
 * Translation tab owns one (`settings-dialog-tab-content.tsx`) and hands it to this
 * and to the audio section, so the two never hold diverging copies.
 *
 * **Every change confirms with a toast that can undo it**, one toast per setting
 * (see `use-setting-saver.ts`).
 */
export function ConversationDefaultsSection({
  settings,
  ready,
  set,
  current,
  running = false,
}: Pick<UseTranslateSettings, 'settings' | 'ready' | 'set' | 'current'> & {
  /** A conversation is running on the page underneath. */
  running?: boolean;
}) {
  const t = useTranslate();
  const { contexts, status } = useTranslationContexts();
  const nameLanguage = languageNamer(t);
  const save = useSettingSaver<TranslateSettings>(set, current);

  // Not rendered against the defaults and corrected a frame later: every row here is
  // a stored value, so a first paint at 1x and 100% for someone who set 1.5x and 40%
  // is the tab visibly changing its own mind. The shape is reserved so nothing below
  // moves.
  if (!ready) {
    return (
      <SettingsSection title={t('web.settings.groupLanguages')}>
        <div className="py-4">
          <Skeleton aria-hidden className="h-72" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      {/* The pairs are a setting HERE and nowhere else: `/translate` and
          `/translate/two-way` name theirs in permanent panel headers. One row per
          page, each headed by the page's own name (the picker draws it), because
          each page keeps its own pair. */}
      <SettingsSection title={t('web.settings.groupLanguages')}>
        <div className="py-4">
          {/* Auto-detect, on the same rule as the `/translate` source control: one
              setting, so the two must offer the same values. */}
          <LanguagePairPicker<SessionLanguagePair>
            value={settings.languagePair}
            disabled={running}
            onChange={(languagePair) =>
              save('languagePair', t('web.settings.oneWayPair'), {
                languagePair: representablePair(languagePair),
              })
            }
            labels={{ ...languagePairLabels(t), pair: t('web.chrome.navTranslate') }}
            nameLanguage={nameLanguage}
            detectOption={
              canAutoDetectInto(settings.languagePair.target)
                ? { label: t('web.translate.autoDetect') }
                : undefined
            }
          />
        </div>
        <div className="py-4">
          {/* The `/translate/two-way` pair: no Auto-detect, and the languages its turn
              identification cannot tell apart listed but not pickable, as there. */}
          <LanguagePairPicker<LanguagePair>
            value={settings.twoWayPair}
            disabled={running}
            onChange={(pair) =>
              save('twoWayPair', t('web.settings.twoWayPair'), pairPatchFor('two-way', pair))
            }
            labels={{ ...languagePairLabels(t), pair: t('web.chrome.navTranslateTwoWay') }}
            nameLanguage={nameLanguage}
            unavailable={{
              codes: LANGUAGE_CODES.filter((code) => !IDENTIFIABLE_LANGUAGES.includes(code)),
              reason: t('web.translate.twoWayLanguageUnavailable'),
            }}
          />
        </div>
      </SettingsSection>

      <VoiceDefaultsSection settings={settings} set={set} current={current} running={running} />

      {/* Which context a NEW conversation starts under. The picker renders nothing
          when the account has authored none — or the list is still loading, or
          failed to — so the whole GROUP is gated on the same condition rather than
          drawing a heading over an empty box. `showLabel` is off because the row
          already draws the name; the picker keeps it `sr-only` for assistive tech. */}
      {status === 'ready' && contexts.length > 0 ? (
        <SettingsSection title={t('web.settings.groupDefaultContext')}>
          <SettingsSectionRow label={t('web.translate.context')} block>
            <ContextPicker
              contexts={contexts}
              status={status}
              value={settings.contextId}
              running={running}
              showLabel={false}
              // The tab says why once, above every group.
              lockNote={false}
              onChange={(contextId) => save('contextId', t('web.translate.context'), { contextId })}
            />
          </SettingsSectionRow>
        </SettingsSection>
      ) : null}

      {/* How a new conversation's transcript is laid out: a default like the rest,
          read from the same storage key, and never reaching the session — so it is
          not frozen while one runs. */}
      <SettingsSection title={t('web.settings.groupDisplay')}>
        <div className="py-4">
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
      </SettingsSection>
    </>
  );
}
