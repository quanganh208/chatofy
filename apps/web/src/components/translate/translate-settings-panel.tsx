'use client';

import { Columns2, Rows3 } from 'lucide-react';
import {
  Card,
  DirectionToggle,
  SegmentedControl,
  Separator,
  Slider,
  Switch,
} from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import { SPEED_PRESETS, type TranslateSettings } from '@/lib/translate-settings';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
import { useVoiceCatalog } from '@/hooks/use-voice-catalog';

/**
 * Everything about how the translation is spoken and read, in one place.
 *
 * A stacked list of label/control rows rather than two panes. The page is a single
 * column at `max-w-2xl`, and a split would fight the transcript's measure on
 * anything narrow — the rows are also what lets later work add one control without
 * re-laying the panel out.
 *
 * Two groups, because the rows answer two different questions: what the voice IS,
 * and how it is delivered. The separator is the whole grouping mechanism; a second
 * heading level would be a third size on a surface whose largest text should be the
 * translation.
 *
 * No accent anywhere. The screen's one accent-filled control is the Start button,
 * and a settings row competing with it would say the two are the same kind of thing.
 */

interface TranslateSettingsPanelProps {
  settings: TranslateSettings;
  /** Whether a conversation is running — see the note on the wire-bound rows. */
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

export function TranslateSettingsPanel({
  settings,
  running,
  onChange,
  onVolumeChange,
}: TranslateSettingsPanelProps) {
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
    <Card className="flex flex-col gap-5 p-6">
      {/*
        Direction and gender ride `client.session.start`, and `ConversationSession`
        stores the options for the whole run with no way to reconfigure them. A
        control that looked live but changed nothing until the next conversation
        would be worse than one that is visibly unavailable.
      */}
      <DirectionToggle
        value={settings.direction}
        onChange={(direction) => onChange({ direction })}
        disabled={running}
      />

      <Row label="Speak translation">
        <Switch
          aria-label="Speak the translation aloud"
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
              Could not load the voice list. The gender choice above still applies.
            </p>
          ) : catalog.voices.length > 0 ? (
            <SegmentedControl
              label="Voice"
              value={selectedVoice}
              options={[
                { value: '', label: 'Default' },
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
            label="Speed"
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
                  'The Vietnamese voice has no rate control, so speed applies only when translating into English.'
            }
          />
        </>
      ) : null}

      <Separator />

      {/* Client-side, so both of these stay live mid-conversation. */}
      <Row label="Volume">
        <div className="flex min-w-48 flex-1 items-center gap-3">
          <Slider
            aria-label="Playback volume"
            value={[settings.volume]}
            min={0}
            max={1}
            step={0.05}
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
        label="Transcript"
        value={settings.transcriptLayout}
        options={[
          {
            value: 'stacked',
            label: (
              <span className="flex items-center gap-1.5">
                <Rows3 aria-hidden className="size-4" /> Stacked
              </span>
            ),
          },
          {
            value: 'columns',
            label: (
              <span className="flex items-center gap-1.5">
                <Columns2 aria-hidden className="size-4" /> Columns
              </span>
            ),
          },
        ]}
        onChange={(transcriptLayout) => onChange({ transcriptLayout })}
        hint="Columns show the original beside its translation, and stack again on a narrow screen."
      />
    </Card>
  );
}
