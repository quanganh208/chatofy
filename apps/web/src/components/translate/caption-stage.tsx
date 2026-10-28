'use client';

import type { SessionLanguagePair } from '@chatofy/types';
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
 * The conversation as captions: what the floating caption window draws.
 *
 * Fullscreen used to draw this too, and stopped: a reader going fullscreen
 * expected the screen they were reading, split as they had split it, and the
 * settings they would otherwise have to leave for — `fullscreen-stage.tsx`.
 *
 * ## One stream, no frame
 *
 * Read in a window the size of a stamp, so none of the page's frame comes along:
 * no pane headers, no language pickers, no voice control. Those configure the
 * session, and the session belongs to the page — a picker here would be a second
 * control for one piece of state with nothing saying so. For the same reason the
 * names on turns are copies, never the attribution control (`interactive` is off).
 *
 * No control of its own either: the browser's close in the window's title bar —
 * a Picture-in-Picture window's, or the popup's — is the way out, and a second X
 * under it closed the same window twice over.
 *
 * One merged stream rather than the page's split, because two columns do not fit
 * the window. `translationOnly` is still honoured: it is about what the reader
 * wants to see, not about arrangement.
 *
 * ## Its own look
 *
 * The stage profile, through the same `readingStyle` the page uses, so the two
 * cannot drift apart in how a look is applied — only in which look it is. The
 * opaque `bg-background` underneath is what a translucent stage ground mixes
 * with: a freshly opened window has nothing behind it but the browser's own
 * blank ground, which the theme's ink was never checked against.
 */
export function CaptionStage({
  settings,
  running,
  stream,
  languagePair,
  className,
}: {
  settings: TranslateSettings;
  running: boolean;
  stream: StreamProps;
  /** The pair the turns on screen were translated for — see `TranscriptPanes`. */
  languagePair: SessionLanguagePair;
  className?: string;
}) {
  const t = useTranslate();
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
