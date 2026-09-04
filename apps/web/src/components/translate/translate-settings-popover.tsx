'use client';

import { Settings2 } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@chatofy/ui/react';
import { TranslateSettingsPanel } from '@/components/translate/translate-settings-panel';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';

/**
 * The settings panel, as a popover hanging off the topbar gear.
 *
 * It used to be a permanent card between the conversation and the transcript, which put
 * a dozen controls nobody is touching mid-conversation in front of the two things this
 * screen exists for. Behind a gear, the column is the conversation and the transcript,
 * and the largest text on the surface is the translation rather than a settings label.
 *
 * **`Popover`, never `Dialog`.** Radix's popover is non-modal by default, and that is the
 * whole reason it is the right primitive here: nothing traps focus or blocks the page
 * underneath, so the transcript stays reachable and readable while the panel is open on
 * top of a live conversation. Passing `modal` would undo that.
 *
 * **Set-once things only.** Direction is not here any more: it is the two panel
 * headers above, permanently on screen, which is the whole point of the layout.
 * What is left is what you choose once and forget — whether the translation is
 * spoken, in which voice, how fast, how loud, and how the transcript is laid out.
 *
 * Width comes from the mockup's 340px rather than the primitive's `w-72`. The height
 * cap is for a laptop in landscape: with voices listed, the panel is taller than a
 * short viewport, and a popover that overflows the window simply cuts off.
 */

interface TranslateSettingsPopoverProps {
  settings: TranslateSettings;
  running: boolean;
  onChange: (patch: Partial<TranslateSettings>) => void;
  onVolumeChange: (volume: number) => void;
}

export function TranslateSettingsPopover(props: TranslateSettingsPopoverProps) {
  const t = useTranslate();
  const label = t('web.translate.settings');

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
        {/* The one mount that hides it: this screen names the direction in its
            panel headers, so a second control for it here would be the same fact
            twice with the quieter copy winning. */}
        <TranslateSettingsPanel {...props} showDirection={false} />
      </PopoverContent>
    </Popover>
  );
}
