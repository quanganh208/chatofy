'use client';

import { Maximize2, PictureInPicture2 } from 'lucide-react';
import { DockActionButton } from '@/components/translate/dock-action-button';
import type { CaptionWindowKind } from '@/hooks/use-caption-window';
import { useTranslate } from '@/i18n/provider';

/**
 * The two ways out of the page: fullscreen, and the floating caption window.
 *
 * In the dock beside the display gear, as outline buttons with a visible word
 * above the dock's wide breakpoint and a tooltip below it (see `DockActionButton`
 * for why: ghost icons read as disabled). Never accent: the screen's one filled
 * control is Start.
 *
 * The window button is named for the window it will actually open. "Picture-in
 * -picture" promises a window that stays on top; a popup does not, and calling
 * it that would be a promise the browser then breaks. Its visible word is the
 * generic "Captions", and the specific window name stays in the accessible name
 * after it, so the name contains the word.
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

  const fullscreenLabel = t('web.translate.fullscreen');
  const captions = t('web.translate.dockCaptions');

  return (
    <>
      <DockActionButton
        dock
        label={fullscreenLabel}
        aria-label={fullscreenLabel}
        onClick={onFullscreen}
      >
        <Maximize2 aria-hidden />
      </DockActionButton>
      <DockActionButton
        dock
        label={captions}
        aria-label={`${captions}: ${windowLabel}`}
        aria-pressed={windowOpen}
        onClick={onToggleWindow}
      >
        <PictureInPicture2 aria-hidden />
      </DockActionButton>
    </>
  );
}
