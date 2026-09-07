'use client';

import { Settings2 } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@chatofy/ui/react';
import { DisplaySettingsPanel } from '@/components/translate/display-settings-panel';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';

/**
 * How the page is laid out, from the gear at the end of the dock.
 *
 * **It used to hold the voice as well, and that was the arrangement's mistake.**
 * One icon at the bottom-right covered "what am I hearing" and "how is the page
 * arranged" without naming either, while the speaker in the panel header — the
 * one thing on the screen that is visibly about sound — configured nothing. The
 * voice moved to that header; what stayed here is the page.
 *
 * Its predecessor's other lesson still holds: this began as a permanent card
 * between the conversation and the transcript, which put a dozen controls nobody
 * touches mid-conversation in front of the two things the screen exists for.
 *
 * **`Popover`, never `Dialog`.** Radix's popover is non-modal by default, and that
 * is the whole reason it is the right primitive here: nothing traps focus or
 * blocks the page underneath, so the transcript stays reachable and readable while
 * the panel is open on top of a live conversation. Passing `modal` would undo that.
 */
export function DisplaySettingsPopover({
  settings,
  onChange,
}: {
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
}) {
  const t = useTranslate();
  const label = t('web.translate.displaySettings');

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Outline, not ghost: it sits on the page ground at the end of the dock
            rather than among the topbar's other icons, and a control with no edge
            there reads as an icon someone forgot to finish. Still not accent — the
            screen's one filled control is Start. */}
        <Button variant="outline" size="icon" aria-label={label}>
          <Settings2 aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        aria-label={label}
        className="max-h-[min(34rem,calc(100vh-5rem))] w-85 overflow-y-auto"
      >
        <DisplaySettingsPanel settings={settings} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
