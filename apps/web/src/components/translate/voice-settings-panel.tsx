'use client';

import { useState } from 'react';
import { Volume2, Volume1 } from 'lucide-react';
import { SegmentedControl, Slider, Switch } from '@chatofy/ui/react';
import { AUTO_DETECT, type LanguageCode } from '@chatofy/types';
import { SPEED_PRESETS, asksTwoWay, type TranslateSettings } from '@/lib/translate-settings';
import { VoiceScopeToggle, type VoiceScope } from '@/components/translate/voice-scope-toggle';
import { VoicePicker } from '@/components/translate/voice-picker';
import { SettingsRow } from '@/components/translate/settings-row';
import { useVoiceCatalog } from '@/hooks/use-voice-catalog';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';

/**
 * Whether the translation is spoken, and — only if it is — how.
 *
 * Everything here hangs off one switch, and that is the whole shape of the
 * component: with playback off there is no voice, no speed and no loudness to
 * choose, so there is nothing under the switch at all.
 *
 * **Volume used to escape that.** It sat below a separator with the transcript
 * layout, under a comment grouping the two as "client-side, so both stay live
 * mid-conversation" — which conflated being ADJUSTABLE with being MEANINGFUL. It
 * is the one audio control that can change during a conversation, and that is
 * exactly why it looked like it belonged with the page settings rather than with
 * the voice. With playback off it was still there, setting the loudness of
 * silence. It is inside the switch now, where the rest of the audio lives.
 *
 * Hidden rather than disabled, throughout: a disabled control invites you to work
 * out how to enable it, and the switch immediately above is already the answer.
 *
 * **Everything except volume is `disabled` while running.** They ride
 * `client.session.start` and `ConversationSession` holds them for the whole run,
 * so a control that stayed live would accept the press and change nothing until
 * the next conversation. Volume reaches a gain node in this tab and is live.
 *
 * No accent anywhere. The screen's one accent-filled control is Start.
 *
 * **Two-way speaks both languages, so it offers a voice for each.** A reply in
 * the target is read out in the source, and a token from one language's engine
 * means nothing to the other's — so each spoken language gets its own picker,
 * named by its language. Auto-detect speaks only the target, so it keeps one.
 * The gender scope above them is shared: it is one stored setting.
 */

/** The languages a conversation started from `pair` may speak, target first. */
function spokenLanguages(pair: TranslateSettings['languagePair']): LanguageCode[] {
  return pair.source !== AUTO_DETECT && asksTwoWay(pair)
    ? [pair.target, pair.source]
    : [pair.target];
}

interface VoiceSettingsPanelProps {
  settings: TranslateSettings;
  /** A conversation is running, so everything but volume is fixed for its duration. */
  running: boolean;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Applies gain immediately, without waiting for the debounced persist. */
  onVolumeChange: (volume: number) => void;
}

export function VoiceSettingsPanel({
  settings,
  running,
  onChange,
  onVolumeChange,
}: VoiceSettingsPanelProps) {
  const t = useTranslate();
  const nameLanguage = languageNamer(t);
  const languages = spokenLanguages(settings.languagePair);
  const [outputLanguage, otherLanguage] = languages as [LanguageCode, LanguageCode | undefined];
  // Two calls, always, so the hook count never changes with the pair. With one
  // spoken language the second asks for the same list, which the catalog cache
  // answers without a request.
  const outputCatalog = useVoiceCatalog(outputLanguage);
  const otherCatalog = useVoiceCatalog(otherLanguage ?? outputLanguage);
  // Reconciled HERE rather than when settings were loaded: the catalog arrives
  // over HTTP, so a synchronous read of storage cannot know whether a saved token
  // still exists. A token the running backend no longer lists falls back to the
  // gender default, which is what the server would do with it anyway.
  const rows = languages.map((language, index) => {
    const catalog = index === 0 ? outputCatalog : otherCatalog;
    const selected = catalog.voices.find((voice) => voice.token === settings.voice[language]);
    return { language, catalog, selected };
  });
  // Shown unless every engine about to speak has explicitly said it ignores
  // `speed`. `speedAdjustable` is tri-state (`SpeedAdjustable`'s doc):
  // `'unknown'` — the catalog is still loading, the lookup failed, or the API
  // predates the field — must keep the control visible rather than hiding a
  // working slider for the length of a request or a stale deploy. Only an
  // explicit `false` hides it.
  const speedApplies = rows.some(({ catalog }) => catalog.speedAdjustable !== false);

  // Which voices are LISTED is a browsing state, not a setting: `all` says
  // nothing about what is spoken, so there is nothing to persist and it opens
  // there every time. Everything is one press away from `all`, and both of its
  // defaults are in the list, so it is a scope you can leave this sitting in —
  // which is what a starting state has to be.
  const [scope, setScope] = useState<VoiceScope>('all');
  // What "Default" means right now, read off the output language's voice. `all`
  // names no default of its own, so the stored gender keeps answering for it.
  const voiceGender = rows[0]?.selected?.gender ?? settings.voiceGender;

  return (
    <div className="flex flex-col gap-5">
      <SettingsRow icon={Volume2} label={t('web.translate.speakTranslation')}>
        <Switch
          aria-label={t('web.translate.speakTranslationAria')}
          checked={settings.voiceOutput}
          disabled={running}
          onCheckedChange={(voiceOutput) => onChange({ voiceOutput })}
        />
      </SettingsRow>

      {/* Why the switch is refusing, said as the thing to do instead. Only while
          running: at rest it is not refusing anything, and a permanent caveat
          under a working control is noise. */}
      {running ? (
        <p className="text-muted-foreground text-hint">{t('web.translate.speakLocked')}</p>
      ) : null}

      {settings.voiceOutput ? (
        <>
          <VoiceScopeToggle
            value={scope}
            onChange={(next) => {
              setScope(next);
              // Narrowing away from the voice being spoken is the one case that
              // has to touch a setting: the picker would otherwise hold a value
              // no listed item carries. It falls back to that gender's default,
              // which is what the scope now offers. Widening to `all`, or
              // narrowing to the gender already speaking, changes only what is
              // listed — and must not silently drop the chosen voice.
              if (next !== 'all' && next !== voiceGender) {
                const voice = { ...settings.voice };
                for (const { language, selected } of rows) {
                  if (selected?.gender !== next) voice[language] = undefined;
                }
                onChange({ voiceGender: next, voice });
              }
            }}
            disabled={running}
          />

          {/* Empty catalog, failed lookup and a list of voices are three different
              answers, and the picker owns all three — see `voice-picker.tsx`. */}
          {rows.map(({ language, catalog, selected }) => (
            <VoicePicker
              key={language}
              catalog={catalog}
              scope={scope}
              gender={selected?.gender ?? settings.voiceGender}
              value={selected?.token ?? ''}
              disabled={running}
              label={
                rows.length > 1
                  ? `${t('web.translate.voice')} · ${nameLanguage(language)}`
                  : undefined
              }
              onChange={(token, gender) =>
                onChange({
                  // Reported by the picker with the voice rather than looked up
                  // after it: in `all` a chosen voice may come from the other pool
                  // than the one stored, and one of the two "Default" entries IS
                  // the gender choice — it names no token to look up.
                  voiceGender: gender,
                  // Stored per output language: the token means nothing to the
                  // engine that speaks the other one.
                  voice: { ...settings.voice, [language]: token },
                })
              }
            />
          ))}

          {/* Absent, not disabled, when the voice about to speak has no rate
              control. A greyed row plus a sentence explaining why it is greyed
              spends two lines of the panel on a thing you cannot do; removing it
              says the same and asks nothing of the reader.

              The setting itself is untouched — it is stored per conversation and
              still sent, and the server hands it to whichever engine speaks the
              output language. Switching the pair brings the row back with the
              value the reader last chose. */}
          {speedApplies ? (
            <SegmentedControl
              label={t('web.translate.speed')}
              density="compact"
              // The options are one value at six magnitudes, so an even row reads
              // as the scale it is. Ragged widths put emphasis on `0.75×` for no
              // reason except that the number is longer.
              equalWidth
              value={String(settings.speed)}
              options={SPEED_PRESETS.map((preset) => ({
                value: String(preset),
                label: `${preset}×`,
              }))}
              disabled={running}
              onChange={(value) => onChange({ speed: Number(value) })}
            />
          ) : null}

          {/* Live mid-conversation, unlike everything above it — the value reaches
              a gain node in this tab rather than the session. That is why it is
              the LAST row rather than a separate group: being adjustable now is
              not the same as being a different kind of setting, and treating it
              as one is how it ended up outside the switch that gives it meaning. */}
          <SettingsRow icon={Volume1} label={t('web.translate.volume')}>
            <div className="flex min-w-48 flex-1 items-center gap-3">
              <Slider
                aria-label={t('web.translate.volumeAria')}
                value={[settings.volume]}
                min={0}
                max={1}
                // 0.01, so every reachable position maps to its own whole percent in
                // the readout beside it. At 0.05 the number jumped in fives and two
                // thirds of the values it could display were unreachable by dragging.
                step={0.01}
                onValueChange={([next]) => {
                  // Radix types the payload as a possibly-empty array; a single-thumb
                  // slider always reports one value, and falling back to the current
                  // one is more honest than asserting that.
                  const volume = next ?? settings.volume;
                  // Straight to the gain node, then into settings. The write to
                  // storage is debounced inside the settings hook, so a drag is one
                  // write.
                  onVolumeChange(volume);
                  onChange({ volume });
                }}
              />
              <span className="text-hint text-muted-foreground w-10 shrink-0 text-right tabular-nums">
                {Math.round(settings.volume * 100)}%
              </span>
            </div>
          </SettingsRow>
        </>
      ) : null}
    </div>
  );
}
