'use client';

import { useState } from 'react';
import { Volume2, Volume1 } from 'lucide-react';
import { SegmentedControl, Slider, Switch } from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import { SPEED_PRESETS, type TranslateSettings } from '@/lib/translate-settings';
import { VoiceScopeToggle, type VoiceScope } from '@/components/translate/voice-scope-toggle';
import { VoicePicker } from '@/components/translate/voice-picker';
import { SettingsRow } from '@/components/translate/settings-row';
import { useVoiceCatalog } from '@/hooks/use-voice-catalog';
import { useTranslate } from '@/i18n/provider';

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
 */

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
  // Rate is applied by the engine that speaks the OUTPUT language, and only the
  // English one has it. Derived from direction rather than stored, so it can never
  // disagree with the direction actually in force.
  const speedApplies = settings.direction === 'vi_to_en';

  const catalog = useVoiceCatalog(settings.direction);
  const outputLanguage = directionLanguages(settings.direction).target;
  // Reconciled HERE rather than when settings were loaded: the catalog arrives
  // over HTTP, so a synchronous read of storage cannot know whether a saved token
  // still exists. A token the running backend no longer lists falls back to the
  // gender default, which is what the server would do with it anyway.
  const savedVoice = settings.voice[outputLanguage];
  const selected = catalog.voices.find((voice) => voice.token === savedVoice);
  const selectedVoice = selected?.token ?? '';

  // Which voices are LISTED is a browsing state, not a setting: `all` says
  // nothing about what is spoken, so there is nothing to persist and it opens
  // there every time. Everything is one press away from `all`, and both of its
  // defaults are in the list, so it is a scope you can leave this sitting in —
  // which is what a starting state has to be.
  const [scope, setScope] = useState<VoiceScope>('all');
  // What "Default" means right now. `all` names no default of its own, so the
  // stored gender keeps answering for it.
  const voiceGender = selected?.gender ?? settings.voiceGender;

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
                onChange({
                  voiceGender: next,
                  voice: { ...settings.voice, [outputLanguage]: undefined },
                });
              }
            }}
            disabled={running}
          />

          {/* Empty catalog, failed lookup and a list of voices are three different
              answers, and the picker owns all three — see `voice-picker.tsx`. */}
          <VoicePicker
            catalog={catalog}
            scope={scope}
            gender={voiceGender}
            value={selectedVoice}
            disabled={running}
            onChange={(token, gender) =>
              onChange({
                // Reported by the picker with the voice rather than looked up
                // after it: in `all` a chosen voice may come from the other pool
                // than the one stored, and one of the two "Default" entries IS
                // the gender choice — it names no token to look up.
                voiceGender: gender,
                // Stored per output language: the token means nothing to the
                // engine that speaks the other one.
                voice: { ...settings.voice, [outputLanguage]: token },
              })
            }
          />

          {/* Absent, not disabled, when the voice about to speak has no rate
              control. A greyed row plus a sentence explaining why it is greyed
              spends two lines of the panel on a thing you cannot do; removing it
              says the same and asks nothing of the reader.

              The setting itself is untouched — it is stored per conversation and
              still sent, and the server hands it to whichever engine speaks the
              output language. Switching direction brings the row back with the
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
