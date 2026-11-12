'use client';

import { useId } from 'react';
import { Download } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import type { TranscriptFormat } from './use-conversation-file-actions';

interface ConversationDownloadSubmenuProps {
  /** Another file action is running. */
  disabled: boolean;
  /** Minutes exist, so the Markdown file carries them — said beside the item. */
  withMinutes: boolean;
  /** Known before opening that some turn has no time, so subtitles cannot be cut. */
  srtBlocked: boolean;
  onDownload: (format: TranscriptFormat) => void;
}

/**
 * Download transcript ▸ — the three text formats, inside the actions menu.
 *
 * Subtitles disabled carries its reason in the item itself and by
 * `aria-describedby`, rather than vanishing: an option that disappears for some
 * conversations reads as a missing feature, not as a property of this one.
 */
export function ConversationDownloadSubmenu({
  disabled,
  withMinutes,
  srtBlocked,
  onDownload,
}: ConversationDownloadSubmenuProps) {
  const t = useTranslate();
  const srtHint = useId();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-action="download-transcript" disabled={disabled}>
        <Download aria-hidden />
        {t('web.history.downloadTranscript')}
      </DropdownMenuSubTrigger>
      {/* Portalled: inside the menu's own content it would be clipped by that
        content's scroll box and positioned against its transform. */}
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuItem data-action="download-txt" onSelect={() => onDownload('txt')}>
            {t('web.history.downloadText')}
          </DropdownMenuItem>
          <DropdownMenuItem data-action="download-md" onSelect={() => onDownload('md')}>
            {t('web.history.downloadMarkdown')}
            {withMinutes ? (
              <span className="text-hint text-muted-foreground ml-auto pl-4">
                {t('web.history.downloadMarkdownMinutes')}
              </span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-action="download-srt"
            disabled={srtBlocked}
            aria-describedby={srtBlocked ? srtHint : undefined}
            onSelect={() => onDownload('srt')}
            className="flex-wrap"
          >
            {t('web.history.downloadSubtitles')}
            {srtBlocked ? (
              <span id={srtHint} className="text-hint text-muted-foreground basis-full">
                {t('web.history.subtitlesNeedTimes')}
              </span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
