'use client';

import { Columns2, Rows3 } from 'lucide-react';
import { DirectionToggle, SegmentedControl, Separator, Slider, Switch } from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import { SPEED_PRESETS, type TranslateSettings } from '@/lib/translate-settings';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
import { useVoiceCatalog } from '@/hooks/use-voice-catalog';
import { useTranslate } from '@/i18n/provider';
import { directionLabels, makeLanguageName } from '@/i18n/direction-labels';

/**
 * Everything about how the translation is spoken and read, in one place.
 *
 * A stacked list of label/control rows rather than two panes. It now opens inside a
 * popover barely wider than a phone, so a split would have nowhere to go — and the rows
 * are also what lets later work add one control without re-laying the panel out.
 *
 * **It supplies no surface of its own.** It used to return a `Card`, which was right
 * while the only mount was a panel sitting in the page column. There are two mounts now
 * — the popover on `/translate` and, from Phase 8, a card on the Preferences page — so
 * the surface comes from the caller and this returns bare rows. The alternative was a
 * second copy of the component, which would also have meant a second copy of the one
 * settings object (`chatofy.translate-settings`) — a distinction the storage does not
 * make and cannot be asked to.
 *
 * Two groups, because the rows answer two different questions: what the voice IS,
 * and how it is delivered. The separator is the whole grouping mechanism; a second
 * heading level would be a third size on a surface whose largest text should be the
 * translation.
 *
 * ## `showDirection`, and why it is a prop rather than a deletion
 *
 * On `/translate` the direction is no longer a setting at all: it is the two panel
 * headers, permanently on screen, with the swap between them. So the popover mount
 * passes `showDirection={false}` and the row is gone from the surface that has a
 * better answer for it.
 *
 * `/preferences` has no panel headers, and the conversation DEFAULTS are exactly
 * what that page is for — so the row stays there. Deleting the row outright would
 * have taken direction off the only screen where it is still a setting.
 *
 * No accent anywhere. The screen's one accent-filled control is the Start button,
 * and a settings row competing with it would say the two are the same kind of thing.
 */

interface TranslateSettingsPanelProps {
  settings: TranslateSettings;
  /** Whether a conversation is running — see the note on the wire-bound rows. */
  running: boolean;
  /**
   * Whether the direction row belongs on this mount.
   *
   * Defaults to true: a mount that does not say otherwise is a settings surface,
   * and forgetting the prop should not silently drop a control.
   */
  showDirection?: boolean;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Applies gain immediately, without waiting for the debounced persist. */
  onVolumeChange: (volume: number) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

export function TranslateSettingsPanel({
  settings,
  running,
  showDirection = true,
  onChange,
  onVolumeChange,
}: TranslateSettingsPanelProps) {
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
  const selectedVoice =
    savedVoice && catalog.voices.some((voice) => voice.token === savedVoice) ? savedVoice : '';

  return (
    <div className="flex flex-col gap-5">
      {/*
        Direction and gender ride `client.session.start`, and `ConversationSession`
        stores the options for the whole run with no way to reconfigure them. A
        control that looked live but changed nothing until the next conversation
        would be worse than one that is visibly unavailable.
      */}
      {showDirection ? (
        <DirectionToggle
          value={settings.direction}
          onChange={(direction) => onChange({ direction })}
          disabled={running}
          labels={directionLabels(t)}
          nameLanguage={makeLanguageName(t)}
        />
      ) : null}

      <Row label={t('web.translate.speakTranslation')}>
        <Switch
          aria-label={t('web.translate.speakTranslationAria')}
          checked={settings.voiceOutput}
          disabled={running}
          onCheckedChange={(voiceOutput) => onChange({ voiceOutput })}
        />
      </Row>

      {/* Everything about the voice is meaningless when nothing is spoken. Hidden
          rather than disabled: a disabled control invites you to work out how to
          enable it, and the switch immediately above is already the answer. */}
      {settings.voiceOutput ? (
        <>
          {/* The one thing the deleted hub's readiness card said that was advice
              rather than a measurement, re-homed where it is actually true. On the
              hub it showed unconditionally, including to someone who had turned
              playback off; here it appears with the setting that causes the
              problem. The cascade path keeps the microphone open through playback
              (`fullDuplex`), so the translation is audible to it. */}
          <p className="text-muted-foreground text-hint max-w-prose">
            {t('web.translate.headphonesHint')}
          </p>
          <VoiceGenderToggle
            value={settings.voiceGender}
            onChange={(voiceGender) => onChange({ voiceGender })}
            disabled={running}
          />

          {/* Only when the backend actually published voices. An empty catalog is
              a real answer — that backend offers no choice — and gender above is
              already the control for it. A FAILED lookup is shown instead of
              hidden, so a stopped sidecar or an expired session cannot look
              identical to a backend that simply has one voice. */}
          {catalog.status === 'failed' ? (
            <p className="text-muted-foreground text-hint max-w-prose">
              {t('web.translate.voiceListFailed')}
            </p>
          ) : catalog.voices.length > 0 ? (
            <SegmentedControl
              label={t('web.translate.voice')}
              value={selectedVoice}
              options={[
                { value: '', label: t('web.translate.voiceDefault') },
                ...catalog.voices.map((voice) => ({
                  value: voice.token,
                  label: voice.label,
                })),
              ]}
              disabled={running}
              onChange={(token) =>
                onChange({
                  // Stored per output language: the token means nothing to the
                  // engine that speaks the other one.
                  voice: { ...settings.voice, [outputLanguage]: token || undefined },
                })
              }
            />
          ) : null}

          <SegmentedControl
            label={t('web.translate.speed')}
            value={String(settings.speed)}
            options={SPEED_PRESETS.map((preset) => ({
              value: String(preset),
              label: `${preset}×`,
            }))}
            disabled={running || !speedApplies}
            onChange={(value) => onChange({ speed: Number(value) })}
            hint={
              speedApplies
                ? undefined
                : // Full opacity, its own token pair, and OUTSIDE any dimmed
                  // wrapper: this is the explanation of a disabled state, not
                  // disabled content, and it is the one thing here someone has to
                  // be able to read.
                  t('web.translate.speedHint')
            }
          />
        </>
      ) : null}

      <Separator />

      {/* Client-side, so both of these stay live mid-conversation. */}
      <Row label={t('web.translate.volume')}>
        <div className="flex min-w-48 flex-1 items-center gap-3">
          <Slider
            aria-label={t('web.translate.volumeAria')}
            value={[settings.volume]}
            min={0}
            max={1}
            // 0.01, so every reachable position maps to its own whole percent in the
            // readout below. At 0.05 the number jumped in fives and two thirds of the
            // values it could display were unreachable by dragging.
            step={0.01}
            onValueChange={([next]) => {
              // Radix types the payload as a possibly-empty array; a single-thumb
              // slider always reports one value, and falling back to the current
              // one is more honest than asserting that.
              const volume = next ?? settings.volume;
              // Straight to the gain node, then into settings. The write to storage
              // is debounced inside the settings hook, so a drag is one write.
              onVolumeChange(volume);
              onChange({ volume });
            }}
          />
          <span className="text-hint text-muted-foreground w-10 shrink-0 text-right tabular-nums">
            {Math.round(settings.volume * 100)}%
          </span>
        </div>
      </Row>

      <SegmentedControl
        label={t('web.translate.transcript')}
        value={settings.transcriptLayout}
        options={[
          {
            value: 'stacked',
            label: (
              <span className="flex items-center gap-1.5">
                <Rows3 aria-hidden className="size-4" /> {t('web.translate.transcriptStacked')}
              </span>
            ),
          },
          {
            value: 'columns',
            label: (
              <span className="flex items-center gap-1.5">
                <Columns2 aria-hidden className="size-4" /> {t('web.translate.transcriptColumns')}
              </span>
            ),
          },
        ]}
        onChange={(transcriptLayout) => onChange({ transcriptLayout })}
        hint={t('web.translate.transcriptHint')}
      />
    </div>
  );
}
