'use client';

import { ChevronDown, Volume2, VolumeX } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@chatofy/ui/react';
import { VoiceSettingsPanel } from '@/components/translate/voice-settings-panel';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';

/**
 * The voice, opened from the panel it speaks for.
 *
 * ## Three shapes in three rounds, and why this is the one
 *
 * It began as an inert mark — a speaker glyph with a `title`, reasoning that
 * speak-aloud cannot change mid-conversation so a control would read as broken.
 * Owner review was somebody pressing it repeatedly. It became a plain toggle,
 * which fixed the pressing but left the arrangement wrong in a way the toggle
 * made obvious: this corner is where a reader asks about SOUND, and sound was
 * configured behind a gear at the other end of the screen, next to the transcript
 * layout.
 *
 * So the toggle is the head of the group rather than the whole of it. Off, the
 * popover holds one switch, because with nothing spoken there is no voice, speed
 * or loudness to choose — which is also what stopped the volume slider being
 * adjustable with playback off, a state it had been reachable in.
 *
 * **The trigger keeps saying the state in words.** It is the reason the mark
 * existed and the reason it was worth keeping: "why am I not hearing anything"
 * has to be answerable without opening anything, and a slash through a 16px glyph
 * does not answer it.
 *
 * **Not `disabled` while running, unlike the switch inside it.** Volume is live,
 * so there is always something in here to reach mid-conversation — and the rows
 * that are fixed say so themselves. A disabled trigger would hide a working
 * control behind a dead one.
 *
 * `Popover`, never `Dialog`: Radix's popover is non-modal by default, so the
 * transcript stays readable underneath while a conversation runs. Passing `modal`
 * would undo that.
 */

interface VoiceSettingsPopoverProps {
  settings: TranslateSettings;
  running: boolean;
  onChange: (patch: Partial<TranslateSettings>) => void;
  onVolumeChange: (volume: number) => void;
}

export function VoiceSettingsPopover({
  settings,
  running,
  onChange,
  onVolumeChange,
}: VoiceSettingsPopoverProps) {
  const t = useTranslate();
  const Speaker = settings.voiceOutput ? Volume2 : VolumeX;
  const label = t('web.translate.voiceSettings');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          className="text-prose hover:text-foreground"
        >
          <Speaker aria-hidden className="size-4" />
          {t('web.translate.speakTranslation')}:{' '}
          {t(settings.voiceOutput ? 'web.translate.speakOn' : 'web.translate.speakOff')}
          <ChevronDown aria-hidden className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        aria-label={label}
        // The same cap the display popover carries: with voices listed this is
        // taller than a laptop in landscape, and a popover that overflows the
        // window simply cuts off.
        className="max-h-[min(34rem,calc(100vh-5rem))] w-85 overflow-y-auto"
      >
        <VoiceSettingsPanel
          settings={settings}
          running={running}
          onChange={onChange}
          onVolumeChange={onVolumeChange}
        />
      </PopoverContent>
    </Popover>
  );
}
