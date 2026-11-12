'use client';

import { useState, type RefObject } from 'react';
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
import { useDeferredMenuChoice, type DeferredChoice } from './use-deferred-menu-choice';

interface ConversationActionsDropdownProps {
  conversation: ConversationSummary;
  files: ReturnType<typeof useConversationFileActions>;
  /** The row's visible name, for the trigger's accessible name. */
  name: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Rename or Delete was chosen, and the menu has closed. */
  onChoose: (choice: DeferredChoice) => void;
}

/**
 * A list row's `⋯` and the menu it opens: Rename, Copy transcript, Download
 * transcript ▸, Download recording (only with a recording), then Delete….
 *
 * Rename and Delete both open a dialog, which moves focus, and doing that from the
 * item itself raced the menu's focus trap: the dialog took focus while the menu was
 * still mounted, the trap pulled it back, and its unmount then dropped focus on
 * `<body>`. So the item only records the choice; the menu's close reports it and
 * prevents its own return-to-trigger. `useDeferredMenuChoice` holds the pattern,
 * shared with the topbar's `⋯`.
 *
 * `data-action` names each item for the specs, which cannot pick a menu item by its
 * text with a selector and must not depend on the items' order.
 */
export function ConversationActionsDropdown({
  conversation,
  files,
  name,
  triggerRef,
  onChoose,
}: ConversationActionsDropdownProps) {
  const t = useTranslate();
  const deferred = useDeferredMenuChoice(onChoose);
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
          variant="ghost"
          size="icon"
          // 32px drawn on every pointer, so it stays within the row's first line;
          // under `pointer-coarse` an invisible 6px rim widens what a finger can hit
          // to the 44px every touch target gets, without the button growing into
          // the preview line below it.
          className="relative size-8 pointer-coarse:size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']"
          aria-label={t('web.history.rowActions', { title: name })}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={deferred.onCloseAutoFocus}>
        <DropdownMenuItem data-action="rename" onSelect={() => deferred.choose('rename')}>
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
          onSelect={() => deferred.choose('delete')}
        >
          <Trash2 aria-hidden />
          {t('web.history.deleteChoice')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
