'use client';

import { useState, type RefObject } from 'react';
import { AudioLines, ChevronDown, Copy, Download, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import type { ConversationSummary } from '@chatofy/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { ConversationDownloadItems } from './conversation-download-submenu';
import { canExportSrt } from './conversation-export-srt';
import type { useConversationFileActions } from './use-conversation-file-actions';
import { useDeferredMenuChoice } from './use-deferred-menu-choice';

interface ConversationHeaderActionsProps {
  conversation: ConversationSummary;
  files: ReturnType<typeof useConversationFileActions>;
  /** The `⋯`, where focus returns after a cancelled delete. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Rename, where focus returns after the rename dialog. */
  renameRef: RefObject<HTMLButtonElement | null>;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * The open conversation's controls, drawn in the topbar: Rename, Download ▾, and a
 * `⋯` with Copy transcript and Delete….
 *
 * The same three at every width. Below `lg` Rename and Download drop their words
 * and stay as 32px icons with the same accessible names: three icons beside a
 * truncating title fit a 375px bar, so the phone keeps the topbar rather than
 * growing a second header row inside the pane — and at 768px with the sidebar
 * open, the worded buttons pushed the bar past the viewport. Every one is outline: a rename or a
 * file is not the screen's action, and Generate on the Minutes tab is.
 */
export function ConversationHeaderActions({
  conversation,
  files,
  triggerRef,
  renameRef,
  onRename,
  onDelete,
}: ConversationHeaderActionsProps) {
  const t = useTranslate();
  const deferred = useDeferredMenuChoice((choice) =>
    choice === 'delete' ? onDelete() : onRename(),
  );
  // Read when the menu opens: whether Subtitles can be offered depends on turns.
  const [srtBlocked, setSrtBlocked] = useState(false);
  const iconBelowLg = 'max-lg:size-8 max-lg:px-0';

  return (
    <div data-slot="conversation-header-actions" className="flex items-center gap-1.5">
      <Button
        ref={renameRef}
        variant="outline"
        size="sm"
        data-action="rename"
        className={iconBelowLg}
        aria-label={t('web.history.rename')}
        onClick={onRename}
      >
        <Pencil aria-hidden />
        <span className="max-lg:sr-only">{t('web.history.rename')}</span>
      </Button>

      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return;
          const known = files.known();
          setSrtBlocked(known ? !canExportSrt(known) : false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-action="download"
            disabled={files.busy}
            className={iconBelowLg}
            aria-label={t('web.history.download')}
          >
            <Download aria-hidden />
            <span className="max-lg:sr-only">{t('web.history.download')}</span>
            <ChevronDown aria-hidden className="max-lg:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ConversationDownloadItems
            withMinutes={conversation.hasMinutes}
            srtBlocked={srtBlocked}
            onDownload={(format) => void files.download(format)}
          />
          {conversation.hasRecording ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-action="download-recording"
                onSelect={() => void files.downloadRecording()}
              >
                <AudioLines aria-hidden />
                {t('web.history.downloadRecording')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t('web.history.moreActions')}
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={deferred.onCloseAutoFocus}>
          <DropdownMenuItem
            data-action="copy"
            disabled={files.busy}
            onSelect={() => void files.copy()}
          >
            <Copy aria-hidden />
            {t('web.history.copyTranscript')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Not while a copy or download is still fetching this conversation: the
            file would land for a conversation that had just been deleted. */}
          <DropdownMenuItem
            data-action="delete"
            variant="destructive"
            disabled={files.busy}
            onSelect={() => deferred.choose('delete')}
          >
            <Trash2 aria-hidden />
            {t('web.history.deleteChoice')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
