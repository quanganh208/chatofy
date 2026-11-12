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

interface ConversationDownloadItemsProps {
  /** Minutes exist, so the Markdown file carries them — said beside the item. */
  withMinutes: boolean;
  /** Known before opening that some turn has no time, so subtitles cannot be cut. */
  srtBlocked: boolean;
  onDownload: (format: TranscriptFormat) => void;
}

/**
 * The three text formats, as menu items — inside a row's Download transcript ▸
 * submenu, or as the top of the open conversation's Download menu in the topbar.
 *
 * Subtitles disabled carries its reason in the item itself and by
 * `aria-describedby`, rather than vanishing: an option that disappears for some
 * conversations reads as a missing feature, not as a property of this one.
 */
export function ConversationDownloadItems({
  withMinutes,
  srtBlocked,
  onDownload,
}: ConversationDownloadItemsProps) {
  const t = useTranslate();
  const srtHint = useId();

  return (
    <>
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
    </>
  );
}

interface ConversationDownloadSubmenuProps extends ConversationDownloadItemsProps {
  /** Another file action is running. */
  disabled: boolean;
}

/** Download transcript ▸ — the three formats as a submenu of a row's `⋯`. */
export function ConversationDownloadSubmenu({
  disabled,
  ...items
}: ConversationDownloadSubmenuProps) {
  const t = useTranslate();

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
          <ConversationDownloadItems {...items} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
