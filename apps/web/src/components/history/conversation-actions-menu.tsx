'use client';

import { useRef, useState } from 'react';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import { renameConversation } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { ConversationActionsDropdown } from './conversation-actions-dropdown';
import { ConversationDeleteDialog } from './conversation-delete-dialog';
import { ConversationHeaderActions } from './conversation-header-actions';
import { ConversationRenameDialog } from './conversation-rename-dialog';
import { useHistoryPanes } from './history-panes-context';
import { useConversationFileActions } from './use-conversation-file-actions';

interface ConversationActionsProps {
  conversation: ConversationSummary;
  /** The full conversation, when the caller has it; a row's menu fetches on choose. */
  loaded?: Conversation;
  /** Minutes the caller already holds; `undefined` reads them for a `.md` on demand. */
  minutes?: MinutesContent | null;
  /** Delete the conversation; rejects when the server refused. */
  onDelete: () => Promise<void>;
  /** A rename was stored — for a caller outside the History layout, which has no panes. */
  onRenamed?: (stored: ConversationSummary) => void;
  /**
   * `header`: the open conversation's controls — Rename, Download ▾ and `⋯` — for
   * the topbar. `row`: one ghost `⋯` pinned beside a row's time, revealed on hover
   * or focus on a fine pointer and always shown on a touch screen.
   */
  placement?: 'header' | 'row';
  /** The visible name, for the row trigger's accessible name and the dialogs. */
  name: string;
}

/**
 * The actions for one conversation — one component behind the topbar and every
 * list row, so the two cannot offer different actions or confirm differently.
 *
 * Rename and Delete open dialogs owned here, so a row's rename no longer has to
 * open the conversation first: the dialog is the editor wherever it was asked
 * for. A stored rename goes to the History layout (`panes.renamed`), which updates
 * the row, the export cache and the open conversation's title alike.
 *
 * ## Budgets
 *
 * Nothing here is accent-filled: Rename and Download are outline, the `⋯` outline
 * or ghost, Save is outline and Delete is `destructive`. An open menu or dialog is
 * one elevated surface, the Download submenu a second while it is open — the
 * ceiling, with nothing else on these screens elevated.
 */
export function ConversationActions({
  conversation,
  loaded,
  minutes,
  onDelete,
  onRenamed,
  placement = 'header',
  name,
}: ConversationActionsProps) {
  const t = useTranslate();
  const panes = useHistoryPanes();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const files = useConversationFileActions({ conversation, loaded, minutes });
  const row = placement === 'row';

  const rename = async (title: string) => {
    const { conversation: stored } = await renameConversation(conversation.conversationId, {
      title,
    });
    panes?.renamed(stored);
    onRenamed?.(stored);
    setRenaming(false);
    notify.success(t('web.history.renamed'), {
      id: `conversation-rename-${stored.conversationId}`,
    });
  };

  const remove = async () => {
    await onDelete();
    notify.success(t('web.history.deleted'));
  };

  const dialogs = (
    <>
      <ConversationRenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={conversation.title}
        onSave={rename}
        restoreFocus={() => (row ? trigger : renameTrigger).current?.focus()}
      />
      <ConversationDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        name={name}
        onDelete={remove}
        restoreFocus={() => trigger.current?.focus()}
      />
    </>
  );

  if (!row) {
    return (
      <>
        <ConversationHeaderActions
          conversation={conversation}
          files={files}
          triggerRef={trigger}
          renameRef={renameTrigger}
          onRename={() => setRenaming(true)}
          onDelete={() => setConfirming(true)}
        />
        {dialogs}
      </>
    );
  }

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
          (renaming || confirming || files.busy) && 'opacity-100',
          'duration-fast ease-standard transition-opacity motion-reduce:transition-none',
        )}
      >
        <ConversationActionsDropdown
          conversation={conversation}
          files={files}
          name={name}
          triggerRef={trigger}
          onChoose={(choice) => (choice === 'delete' ? setConfirming(true) : setRenaming(true))}
        />
      </div>
      {dialogs}
    </>
  );
}
