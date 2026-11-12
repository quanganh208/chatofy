'use client';

import type { ReactNode, RefObject } from 'react';
import type { Conversation, MinutesContent } from '@chatofy/types';
import { useLocale, useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { ConversationActions } from './conversation-actions-menu';
import { ConversationMetaLine } from './conversation-meta-line';
import { ConversationTitleEditor } from './conversation-title-editor';

interface ConversationDetailHeaderProps {
  conversation: Conversation;
  /** The title is a field: Rename was chosen here or on the conversation's row. */
  editing: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Store a new title; rejects when the server refused. */
  onRename: (title: string) => Promise<void>;
  onStartEditing: () => void;
  onStopEditing: () => void;
  /** For a `.md` export; `undefined` when they are not known to be settled. */
  minutes: MinutesContent | null | undefined;
  onDelete: () => Promise<void>;
  /** The recording controls, drawn before the `⋯`. */
  leading: ReactNode;
}

/**
 * The open conversation's title and facts, following the reader in from its row —
 * this is what confirms WHICH conversation opened — with its controls beside them.
 * An `h2`, because the topbar holds the screen's `h1`. While renaming, the title is
 * a field.
 */
export function ConversationDetailHeader({
  conversation,
  editing,
  headingRef,
  onRename,
  onStartEditing,
  onStopEditing,
  minutes,
  onDelete,
  leading,
}: ConversationDetailHeaderProps) {
  const t = useTranslate();
  const locale = useLocale();

  return (
    <header className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3">
      {/* While renaming, the title block takes the header's whole first row:
          beside the player its 12rem basis squeezed the field until Cancel
          wrapped alone. The player and `⋯` move to the row below, still in
          reach and in the same tab order. */}
      <div
        className={cn('flex min-w-0 flex-col gap-1.5', editing ? 'basis-full' : 'flex-[1_1_12rem]')}
      >
        {editing ? (
          <ConversationTitleEditor
            title={conversation.title}
            onSave={onRename}
            onCancel={onStopEditing}
          />
        ) : (
          <h2
            ref={headingRef}
            tabIndex={-1}
            className={
              conversation.title
                ? 'text-heading font-display font-normal tracking-tight text-balance outline-none'
                : 'text-heading font-display text-muted-foreground font-normal tracking-tight text-balance outline-none'
            }
          >
            {conversation.title ?? (conversation.preview || t('web.history.untitled'))}
          </h2>
        )}
        <ConversationMetaLine
          conversation={conversation}
          showTimeRange
          leading={new Date(conversation.startedAt).toLocaleDateString(locale, {
            dateStyle: 'medium',
          })}
        />
      </div>
      <ConversationActions
        conversation={conversation}
        loaded={conversation}
        minutes={minutes}
        onRename={onStartEditing}
        onDelete={onDelete}
        leading={leading}
      />
    </header>
  );
}
