'use client';

import { SegmentedControl, Slider, Switch } from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import { SPEED_PRESETS, type TranslateSettings } from '@/lib/translate-settings';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
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
  const selectedVoice =
    savedVoice && catalog.voices.some((voice) => voice.token === savedVoice) ? savedVoice : '';

  return (
    <div className="flex flex-col gap-5">
      <Row label={t('web.translate.speakTranslation')}>
        <Switch
          aria-label={t('web.translate.speakTranslationAria')}
          checked={settings.voiceOutput}
          disabled={running}
          onCheckedChange={(voiceOutput) => onChange({ voiceOutput })}
        />
      </Row>

      {/* Why the switch is refusing, said as the thing to do instead. Only while
          running: at rest it is not refusing anything, and a permanent caveat
          under a working control is noise. */}
      {running ? (
        <p className="text-muted-foreground text-hint">{t('web.translate.speakLocked')}</p>
      ) : null}

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
                ...catalog.voices.map((voice) => ({ value: voice.token, label: voice.label })),
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

          {/* Live mid-conversation, unlike everything above it — the value reaches
              a gain node in this tab rather than the session. That is why it is
              the LAST row rather than a separate group: being adjustable now is
              not the same as being a different kind of setting, and treating it
              as one is how it ended up outside the switch that gives it meaning. */}
          <Row label={t('web.translate.volume')}>
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
          </Row>
        </>
      ) : null}
    </div>
  );
}
