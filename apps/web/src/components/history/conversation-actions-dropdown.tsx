'use client';

import { useRef, useState, type RefObject } from 'react';
import { AudioLines, Copy, Ellipsis, Pencil, Trash2 } from 'lucide-react';
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
import { ConversationDownloadSubmenu } from './conversation-download-submenu';
import { canExportSrt } from './conversation-export-srt';
import type { useConversationFileActions } from './use-conversation-file-actions';

/** The two items that act once the menu has closed — see `onCloseAutoFocus`. */
export type DeferredChoice = 'rename' | 'delete';

interface ConversationActionsDropdownProps {
  conversation: ConversationSummary;
  files: ReturnType<typeof useConversationFileActions>;
  /** A list row's ghost trigger, named for its conversation; else the header's outline one. */
  row: boolean;
  name?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Rename or Delete was chosen, and the menu has closed. */
  onChoose: (choice: DeferredChoice) => void;
}

/**
 * The `⋯` trigger and the menu it opens: Rename, Copy transcript, Download
 * transcript ▸, Download recording (only with a recording), then Delete….
 *
 * Rename and Delete both move focus — into the title field, onto the strip's Cancel
 * — and doing that from the item itself raced the menu's focus trap: the target was
 * focused while the menu was still mounted, the trap pulled focus back, and its
 * unmount then dropped focus on `<body>`. So the item only records the choice; the
 * menu's close reports it and prevents its own return-to-trigger.
 *
 * `data-action` names each item for the specs, which cannot pick a menu item by its
 * text with a selector and must not depend on the items' order.
 */
export function ConversationActionsDropdown({
  conversation,
  files,
  row,
  name,
  triggerRef,
  onChoose,
}: ConversationActionsDropdownProps) {
  const t = useTranslate();
  const deferred = useRef<DeferredChoice | null>(null);
  // Read when the menu opens: whether Subtitles can be offered depends on turns a
  // row has not fetched yet, and an unknown answer offers it (see `download`).
  const [srtBlocked, setSrtBlocked] = useState(false);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        const known = files.known();
        setSrtBlocked(known ? !canExportSrt(known) : false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant={row ? 'ghost' : 'outline'}
          size="icon"
          // 32px drawn on every pointer, so it stays within the row's first line;
          // under `pointer-coarse` an invisible 6px rim widens what a finger can hit
          // to the 44px every touch target gets, without the button growing into
          // the preview line below it.
          className={
            row
              ? "relative size-8 pointer-coarse:size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']"
              : undefined
          }
          aria-label={
            row && name
              ? t('web.history.rowActions', { title: name })
              : t('web.history.moreActions')
          }
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const choice = deferred.current;
          if (!choice) return;
          deferred.current = null;
          event.preventDefault();
          onChoose(choice);
        }}
      >
        <DropdownMenuItem
          data-action="rename"
          onSelect={() => {
            deferred.current = 'rename';
          }}
        >
          <Pencil aria-hidden />
          {t('web.history.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-action="copy"
          disabled={files.busy}
          onSelect={() => void files.copy()}
        >
          <Copy aria-hidden />
          {t('web.history.copyTranscript')}
        </DropdownMenuItem>
        <ConversationDownloadSubmenu
          disabled={files.busy}
          withMinutes={conversation.hasMinutes}
          srtBlocked={srtBlocked}
          onDownload={(format) => void files.download(format)}
        />
        {conversation.hasRecording ? (
          <DropdownMenuItem
            data-action="download-recording"
            disabled={files.busy}
            onSelect={() => void files.downloadRecording()}
          >
            <AudioLines aria-hidden />
            {t('web.history.downloadRecording')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {/* Not while a copy or download is still fetching this conversation: the
          file would land for a conversation that had just been deleted. */}
        <DropdownMenuItem
          data-action="delete"
          variant="destructive"
          disabled={files.busy}
          onSelect={() => {
            deferred.current = 'delete';
          }}
        >
          <Trash2 aria-hidden />
          {t('web.history.deleteChoice')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
