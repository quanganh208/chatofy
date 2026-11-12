'use client';

import type { ReactNode } from 'react';
import type { Conversation } from '@chatofy/types';
import { useLocale } from '@/i18n/provider';
import { ConversationMetaLine } from './conversation-meta-line';

interface ConversationDetailHeaderProps {
  conversation: Conversation;
  /** The recording controls, beside the facts; `null` without a recording. */
  leading: ReactNode;
}

/**
 * The open conversation's facts — date, time range, languages, speakers — with its
 * recording controls beside them.
 *
 * No title here: the topbar's last crumb is the conversation's name and the
 * screen's `<h1>`, and its actions sit at the topbar's right. A second title in
 * the pane would say the same words twice, one under the other.
 */
export function ConversationDetailHeader({ conversation, leading }: ConversationDetailHeaderProps) {
  const locale = useLocale();

  return (
    <div
      data-slot="conversation-detail-header"
      className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3"
    >
      <div className="min-w-0 flex-[1_1_16rem]">
        <ConversationMetaLine
          conversation={conversation}
          showTimeRange
          leading={new Date(conversation.startedAt).toLocaleDateString(locale, {
            dateStyle: 'medium',
          })}
        />
      </div>
      {leading}
    </div>
  );
}
