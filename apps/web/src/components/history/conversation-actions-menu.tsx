'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import { cn } from '@/lib/utils';
import { ConversationDeleteConfirm } from './conversation-delete-confirm';
import { ConversationActionsDropdown } from './conversation-actions-dropdown';
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

/**
 * The `⋯` menu for one conversation — one component in both the detail header and
 * every list row, so the two cannot offer different actions.
 *
 * The menu itself is `ConversationActionsDropdown`; this places it — beside the
 * recording controls in the header, or pinned beside a row's time — with the notice
 * line its copy and downloads speak through and the delete strip under it.
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
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const files = useConversationFileActions({ conversation, loaded, minutes });
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
    <ConversationActionsDropdown
      conversation={conversation}
      files={files}
      row={row}
      name={name}
      triggerRef={trigger}
      onChoose={(choice) => (choice === 'delete' ? setConfirming(true) : onRename())}
    />
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
