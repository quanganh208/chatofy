'use client';

import { Maximize2, PictureInPicture2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import type { CaptionWindowKind } from '@/hooks/use-caption-window';
import { useTranslate } from '@/i18n/provider';

/**
 * The two ways out of the page: fullscreen, and the floating caption window.
 *
 * In the dock beside the display gear, outline like it, and for the same reason
 * — they sit on the page ground, and a control with no edge there reads as an
 * unfinished icon. Never accent: the screen's one filled control is Start.
 *
 * The window button is named for the window it will actually open. "Picture-in
 * -picture" promises a window that stays on top; a popup does not, and calling
 * it that would be a promise the browser then breaks.
 *
 * `aria-pressed` on the window button, because it is a toggle: pressed again it
 * closes the window it opened.
 */
export function StageControls({
  onFullscreen,
  windowKind,
  windowOpen,
  onToggleWindow,
}: {
  onFullscreen: () => void;
  windowKind: CaptionWindowKind;
  windowOpen: boolean;
  onToggleWindow: () => void;
}) {
  const t = useTranslate();
  const windowLabel = t(windowKind === 'pip' ? 'web.translate.pip' : 'web.translate.miniWindow');

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('web.translate.fullscreen')}
        onClick={onFullscreen}
      >
        <Maximize2 aria-hidden />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label={windowLabel}
        aria-pressed={windowOpen}
        onClick={onToggleWindow}
      >
        <PictureInPicture2 aria-hidden />
      </Button>
    </>
  );
}
