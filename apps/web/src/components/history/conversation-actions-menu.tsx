'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AudioLines, Copy, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { ConversationDeleteConfirm } from './conversation-delete-confirm';
import { ConversationDownloadSubmenu } from './conversation-download-submenu';
import { canExportSrt } from './conversation-export-srt';
import { useConversationFileActions } from './use-conversation-file-actions';

interface ConversationActionsProps {
  conversation: ConversationSummary;
  /** The full conversation, when the caller has it; a row's menu fetches on choose. */
  loaded?: Conversation;
  /** Minutes the caller already holds; `undefined` reads them for a `.md` on demand. */
  minutes?: MinutesContent | null;
  /** Start renaming. The header edits in place; a row opens its conversation first. */
  onRename: () => void;
  /** Delete the conversation; rejects when the server refused. */
  onDelete: () => Promise<void>;
  /** Drawn before the menu, on the same row — the recording controls. */
  leading?: ReactNode;
  /**
   * `header`: an outline `⋯` with the delete strip under the header.
   * `row`: a ghost `⋯` pinned beside the row's time, revealed on hover or focus on
   * a fine pointer and always shown on a touch screen, with the strip under the row.
   */
  placement?: 'header' | 'row';
  /** The row's visible name, for the trigger's and the strip's accessible names. */
  name?: string;
}

/** Chosen in the menu, acted on once the menu has CLOSED — see `onCloseAutoFocus`. */
type Deferred = 'rename' | 'delete' | null;

/**
 * The `⋯` menu for one conversation — one component in both the detail header and
 * every list row, so the two cannot offer different actions.
 *
 * ## Two items act after the menu closes
 *
 * Rename and Delete both move focus — into the title field, onto the strip's Cancel
 * — and doing that from the item itself raced the menu's focus trap: the target was
 * focused while the menu was still mounted, the trap pulled focus back, and its
 * unmount then dropped focus on `<body>`. So the item only records the choice; the
 * menu's close acts on it and prevents its own return-to-trigger.
 *
 * ## Delete is still two steps
 *
 * Choosing Delete deletes nothing. It opens the strip that states the cost beside
 * the one press that acts (`ConversationDeleteConfirm`). Escape and Cancel close it
 * and put focus back on this `⋯`.
 *
 * ## Budgets
 *
 * Nothing here is accent-filled. The open menu is one elevated surface, and the
 * Download submenu a second while it is open — the ceiling, with nothing else on
 * these screens elevated. The strip is a region between hairlines.
 *
 * `data-action` names each item for the specs, which cannot pick a menu item by its
 * text with a selector and must not depend on the items' order.
 */
export function ConversationActions({
  conversation,
  loaded,
  minutes,
  onRename,
  onDelete,
  leading,
  placement = 'header',
  name,
}: ConversationActionsProps) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const deferred = useRef<Deferred>(null);
  const files = useConversationFileActions({ conversation, loaded, minutes });
  // Read when the menu opens: whether Subtitles can be offered depends on turns a
  // row has not fetched yet, and an unknown answer offers it (see `download`).
  const [srtBlocked, setSrtBlocked] = useState(false);
  const row = placement === 'row';

  const close = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  const noticeLine = (
    <p
      aria-live="polite"
      className={cn(
        'text-hint',
        files.notice?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
        row ? 'px-3' : 'pointer-events-none absolute top-full right-0 mt-1 whitespace-nowrap',
      )}
    >
      {files.notice?.text}
    </p>
  );

  const menu = (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        const known = files.known();
        setSrtBlocked(known ? !canExportSrt(known) : false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
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
          if (choice === 'delete') setConfirming(true);
          else onRename();
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
        <DropdownMenuItem
          data-action="delete"
          variant="destructive"
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

  const strip = confirming ? (
    <ConversationDeleteConfirm
      onDelete={onDelete}
      onClose={close}
      name={row ? name : undefined}
      className={row ? 'mx-3 mt-1' : 'basis-full'}
    />
  ) : null;

  if (row) {
    return (
      <>
        {/* A sibling of the row's link, never inside it: a button in an `<a>` is
            invalid, and a press on it would also follow the link. The row stays
            one tab stop plus this one. Hidden by opacity, not `display`, so it is
            still focusable — and focus is what reveals it. */}
        <div
          className={cn(
            'absolute top-1.5 right-1 z-10',
            'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100',
            'pointer-coarse:opacity-100 max-sm:opacity-100',
            (confirming || files.busy || files.notice) && 'opacity-100',
            'duration-fast ease-standard transition-opacity motion-reduce:transition-none',
          )}
        >
          {menu}
        </div>
        {noticeLine}
        {strip}
      </>
    );
  }

  return (
    <>
      <div className="relative flex flex-wrap items-center gap-2">
        {leading}
        {menu}
        {noticeLine}
      </div>
      {strip}
    </>
  );
}
