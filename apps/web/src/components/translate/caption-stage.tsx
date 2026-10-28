'use client';

import { useEffect, useRef } from 'react';
import type { SessionLanguagePair } from '@chatofy/types';
import { X } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { TranscriptScroller } from '@/components/translate/transcript-scroller';
import type { StreamProps } from '@/components/translate/transcript-panes';
import { readingSchemeClass, readingStyle } from '@/lib/reading-appearance';
import {
  effectiveStageAppearance,
  textSizeScale,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * The conversation as captions: what fullscreen and the floating caption window
 * draw.
 *
 * ## One stream, no frame
 *
 * Read across a room or in a window the size of a stamp, so none of the page's
 * frame comes along: no pane headers, no language pickers, no voice control.
 * Those configure the session, and the session belongs to the page — a picker
 * here would be a second control for one piece of state with nothing saying so.
 * For the same reason the names on turns are copies, never the attribution
 * control (`interactive` is off).
 *
 * One merged stream rather than the page's split, because two columns do not fit
 * the window and a room reads one line at a time. `translationOnly` is still
 * honoured: it is about what the reader wants to see, not about arrangement.
 *
 * ## Its own look
 *
 * The stage profile, through the same `readingStyle` the page uses, so the two
 * cannot drift apart in how a look is applied — only in which look it is. The
 * opaque `bg-background` underneath is what a translucent stage ground mixes
 * with: a fullscreen element has nothing behind it but the browser's black
 * backdrop, which the light theme's ink cannot be read on.
 */
export function CaptionStage({
  settings,
  running,
  stream,
  languagePair,
  onClose,
  closeLabel,
  focusOnMount = false,
  className,
}: {
  settings: TranslateSettings;
  running: boolean;
  stream: StreamProps;
  /** The pair the turns on screen were translated for — see `TranscriptPanes`. */
  languagePair: SessionLanguagePair;
  onClose: () => void;
  /** What closing does here: leaving fullscreen, or closing the window. */
  closeLabel: string;
  /**
   * Move focus to the close control on mount. Fullscreen wants it — the control
   * that opened it is now outside the fullscreen element. The caption window must
   * not: focusing inside it would pull focus off the page someone is working in.
   */
  focusOnMount?: boolean;
  className?: string;
}) {
  const t = useTranslate();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) closeButton.current?.focus();
  }, [focusOnMount]);
  const { appearance, textSize } = effectiveStageAppearance(settings);

  return (
    <div className={cn('bg-background text-foreground flex min-h-0 flex-1 flex-col', className)}>
      <div
        className={cn(
          'reading-frame relative flex min-h-0 flex-1 flex-col',
          readingSchemeClass(appearance),
        )}
        style={readingStyle(appearance, textSizeScale(textSize))}
      >
        {/* Ghost, in a row of its own, and never accent: the stage's only control,
            and the page it came from already spends its one filled action on Start.
            Its own row rather than floated over the corner: floated, it sat on the
            first line of captions at phone width, which is where they start. */}
        <div className="flex shrink-0 justify-end p-1">
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>
        <TranscriptScroller
          label={t('web.translate.captionStage')}
          freeScroll={settings.freeScroll}
        >
          <ConversationTranscript
            {...stream}
            running={running}
            side={settings.translationOnly ? 'target' : 'both'}
            interactive={false}
            speakerLabels={settings.speakerLabels}
            showTime={appearance.showTime}
            languagePair={languagePair}
          />
        </TranscriptScroller>
      </div>
    </div>
  );
}
