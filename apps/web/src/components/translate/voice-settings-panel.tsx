'use client';

import { useState } from 'react';
import { Volume2, Volume1 } from 'lucide-react';
import { SegmentedControl, Slider, Switch } from '@chatofy/ui/react';
import type { LanguageCode } from '@chatofy/types';
import {
  SPEED_PRESETS,
  languageVoice,
  languageVoicePatch,
  type LanguageVoiceSetup,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { VoiceScopeToggle, type VoiceScope } from '@/components/translate/voice-scope-toggle';
import { VoicePicker } from '@/components/translate/voice-picker';
import { SettingsRow } from '@/components/translate/settings-row';
import { useVoiceCatalog } from '@/hooks/use-voice-catalog';
import { useTranslate } from '@/i18n/provider';

/**
 * How ONE language is spoken: whether at all, and — only if it is — in which
 * voice, how fast and how loud.
 *
 * **One language per panel.** A two-way conversation used to get one panel with
 * a picker per language under one switch, one rate and one volume, all opened
 * from the target's header. That made the switch a lie for half the room — a
 * reader who wanted English spoken and Vietnamese not had no way to say so — and
 * the rate a lie for half the engines, since the Vietnamese one ignores it. Each
 * language now has its own setup (`LanguageVoiceSetup`), and each header opens
 * the panel for its own language.
 *
 * Everything here hangs off the one switch: with playback off there is no voice,
 * no speed and no loudness to choose, so there is nothing under the switch at
 * all. Hidden rather than disabled: a disabled control invites you to work out
 * how to enable it, and the switch immediately above is already the answer.
 *
 * **Everything except volume is `disabled` while running.** They ride
 * `client.session.start` and `ConversationSession` holds them for the whole run,
 * so a control that stayed live would accept the press and change nothing until
 * the next conversation. Volume reaches this language's gain stage in this tab
 * and is live — it is the last row for that reason, not a separate group.
 *
 * No accent anywhere. The screen's one accent-filled control is Start.
 */

interface VoiceSettingsPanelProps {
  settings: TranslateSettings;
  /** Which language's setup this panel reads and writes. */
  language: LanguageCode;
  /** A conversation is running, so everything but volume is fixed for its duration. */
  running: boolean;
  /**
   * Whether this panel says why its switch is frozen while running. On by default:
   * in the `/translate` popover the panel is the only thing on screen to say it. A
   * host that already says it once for several panels (the Settings dialog's
   * Translation tab) turns it off so the reason is not repeated per language.
   */
  lockNote?: boolean;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Applies gain to this language immediately, without waiting for the debounced persist. */
  onVolumeChange: (volume: number, language: LanguageCode) => void;
}

export function VoiceSettingsPanel({
  settings,
  language,
  running,
  lockNote = true,
  onChange,
  onVolumeChange,
}: VoiceSettingsPanelProps) {
  const t = useTranslate();
  const setup = languageVoice(settings, language);
  const set = (patch: Partial<LanguageVoiceSetup>) =>
    onChange(languageVoicePatch(settings, language, patch));
  const catalog = useVoiceCatalog(language);
  // Reconciled HERE rather than when settings were loaded: the catalog arrives
  // over HTTP, so a synchronous read of storage cannot know whether a saved token
  // still exists. A token the running backend no longer lists falls back to the
  // gender default, which is what the server would do with it anyway.
  const selected = catalog.voices.find((voice) => voice.token === setup.voice);
  // Shown unless this language's engine has explicitly said it ignores `speed`.
  // `speedAdjustable` is tri-state (`SpeedAdjustable`'s doc): `'unknown'` — the
  // catalog is still loading, the lookup failed, or the API predates the field —
  // keeps the control visible rather than hiding a working slider for the length
  // of a request or a stale deploy. Only an explicit `false` hides it.
  const speedApplies = catalog.speedAdjustable !== false;

  // Which voices are LISTED is a browsing state, not a setting: `all` says
  // nothing about what is spoken, so there is nothing to persist and it opens
  // there every time. Everything is one press away from `all`, and both of its
  // defaults are in the list, so it is a scope you can leave this sitting in —
  // which is what a starting state has to be.
  const [scope, setScope] = useState<VoiceScope>('all');
  // What "Default" means right now. `all` names no default of its own, so the
  // stored gender keeps answering for it.
  const gender = selected?.gender ?? setup.gender;

  return (
    <div className="flex flex-col gap-5">
      <SettingsRow icon={Volume2} label={t('web.translate.speakTranslation')}>
        <Switch
          aria-label={t('web.translate.speakTranslationAria')}
          checked={setup.speak}
          disabled={running}
          onCheckedChange={(speak) => set({ speak })}
        />
      </SettingsRow>

      {/* Why the switch is refusing, said as the thing to do instead. Only while
          running: at rest it is not refusing anything, and a permanent caveat
          under a working control is noise. */}
      {running && lockNote ? (
        <p className="text-muted-foreground text-hint">{t('web.translate.speakLocked')}</p>
      ) : null}

      {setup.speak ? (
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
              if (next !== 'all' && next !== gender) set({ gender: next, voice: undefined });
            }}
            disabled={running}
          />

          {/* Empty catalog, failed lookup and a list of voices are three different
              answers, and the picker owns all three — see `voice-picker.tsx`. */}
          <VoicePicker
            catalog={catalog}
            scope={scope}
            gender={gender}
            value={selected?.token ?? ''}
            disabled={running}
            onChange={(voice, nextGender) =>
              // The gender is reported by the picker with the voice rather than
              // looked up after it: in `all` a chosen voice may come from the
              // other pool than the one stored, and one of the two "Default"
              // entries IS the gender choice — it names no token to look up.
              set({ gender: nextGender, voice })
            }
          />

          {/* Absent, not disabled, when this language's engine has no rate
              control. The stored rate is untouched and still sent, so an engine
              that gains one later picks up what the reader last chose. */}
          {speedApplies ? (
            <SegmentedControl
              label={t('web.translate.speed')}
              density="compact"
              // The options are one value at six magnitudes, so an even row reads
              // as the scale it is.
              equalWidth
              value={String(setup.speed)}
              options={SPEED_PRESETS.map((preset) => ({
                value: String(preset),
                label: `${preset}×`,
              }))}
              disabled={running}
              onChange={(value) => set({ speed: Number(value) })}
            />
          ) : null}

          <SettingsRow icon={Volume1} label={t('web.translate.volume')}>
            <div className="flex min-w-48 flex-1 items-center gap-3">
              <Slider
                aria-label={t('web.translate.volumeAria')}
                value={[setup.volume]}
                min={0}
                max={1}
                // 0.01, so every reachable position maps to its own whole percent in
                // the readout beside it.
                step={0.01}
                onValueChange={([next]) => {
                  // Radix types the payload as a possibly-empty array; a single-thumb
                  // slider always reports one value.
                  const volume = next ?? setup.volume;
                  // Straight to this language's gain stage, then into settings.
                  // The write to storage is debounced inside the settings hook,
                  // so a drag is one write.
                  onVolumeChange(volume, language);
                  set({ volume });
                }}
              />
              <span className="text-hint text-muted-foreground w-10 shrink-0 text-right tabular-nums">
                {Math.round(setup.volume * 100)}%
              </span>
            </div>
          </SettingsRow>
        </>
      ) : null}
    </div>
  );
}
