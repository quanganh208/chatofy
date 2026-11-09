'use client';

/**
 * Captions and sound, inside the call.
 *
 * Other meeting products let each person decide what they read and how loud the original
 * speaker is next to the translation (Google Meet's caption settings, Zoom's original-voice
 * balance, Wordly's listen-or-read choice). A call here had only mic, camera and Leave, so
 * a reader who found the captions too small or the original voices too loud had no recourse.
 *
 * Every control is personal and local: nothing here is sent to the other people. It is
 * outline like the mic and camera beside it, never the accent: Leave stays the one filled
 * control on the screen.
 */

import { Captions, SlidersHorizontal, Volume1 } from 'lucide-react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Slider,
  Switch,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import type { CallPreferences, CaptionSize } from '@/hooks/use-call-preferences';

const SIZE_OPTIONS: ReadonlyArray<{ value: CaptionSize; label: string }> = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
  { value: 'xl', label: 'XL' },
];

export function ListeningMenu({
  prefs,
  onChange,
}: {
  prefs: CallPreferences;
  onChange: (patch: Partial<CallPreferences>) => void;
}) {
  const t = useTranslate();
  const title = t('web.conference.soundCaptionsTitle');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label={title}>
          <SlidersHorizontal className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" aria-label={title} className="w-80">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-6">
            <span className="text-body flex items-center gap-2.5 font-medium">
              <Captions aria-hidden className="text-muted-foreground size-4 shrink-0" />
              {t('web.conference.captionsShow')}
            </span>
            <Switch
              aria-label={t('web.conference.captionsShow')}
              checked={prefs.captions}
              onCheckedChange={(captions) => onChange({ captions })}
            />
          </div>

          <SegmentedControl
            label={t('web.conference.captionSize')}
            value={prefs.captionSize}
            options={SIZE_OPTIONS}
            disabled={!prefs.captions}
            onChange={(captionSize) => onChange({ captionSize })}
          />

          <div className="flex flex-col gap-2">
            <span className="text-body flex items-center gap-2.5 font-medium">
              <Volume1 aria-hidden className="text-muted-foreground size-4 shrink-0" />
              {t('web.conference.originalVolume')}
            </span>
            <div className="flex items-center gap-3">
              <Slider
                aria-label={t('web.conference.originalVolumeAria')}
                value={[prefs.originalVolume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([next]) =>
                  onChange({ originalVolume: next ?? prefs.originalVolume })
                }
              />
              <span className="text-hint text-muted-foreground w-10 shrink-0 text-right tabular-nums">
                {Math.round(prefs.originalVolume * 100)}%
              </span>
            </div>
            <p className="text-hint text-muted-foreground">
              {t('web.conference.originalVolumeHint')}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
