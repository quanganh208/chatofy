'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { dawn } from '@chatofy/ui';
import type { ConversationSummary } from '@chatofy/types';
import { Badge } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import { useLocale, useTranslate } from '@/i18n/provider';
import { ConversationActions } from './conversation-actions-menu';
import { formatTime } from './conversation-formatting';
import { ConversationMetaLine } from './conversation-meta-line';
import { useHistoryPanes } from './history-panes-context';

interface HistoryListRowProps {
  conversation: ConversationSummary;
  /** The conversation open in the reading pane beside the list. */
  selected: boolean;
  /** `?q=…` when a search is in effect, so opening a row keeps it in the URL. */
  querySuffix: string;
  /** Called for a click that navigates in place — not one opening a new tab. */
  onOpen?: (pathname: string) => void;
}

/**
 * One conversation: title and time, the first line, then what kind of conversation
 * it was — three lines, read top to bottom, in a column as narrow as the list pane.
 *
 * The whole row is the link and therefore one tab stop. **It does not lift on
 * hover.** Lifting is what a button does, and the control vocabulary rests on that
 * asymmetry; hover and focus are one step up the neutral scale, and nothing moves.
 *
 * Selected is the same muted fill plus the sidebar's dawn bar, drawn the same way —
 * so "the thing open beside you" reads identically in the nav and in the list. The
 * bar is decoration; `aria-current` is what says it.
 *
 * ## The row's `⋯`
 *
 * The same actions menu as the open conversation's header, drawn beside the time
 * as the link's SIBLING — rendered into the parent `<li>`, which positions it. Inside
 * the link it would be invalid markup and every press on it would also open the
 * row. The first line reserves room on its right so the time never runs under it. Only
 * inside the History layout, which is what carries out a row's rename and delete.
 */
export function HistoryListRow({
  conversation,
  selected,
  querySuffix,
  onOpen,
}: HistoryListRowProps) {
  const t = useTranslate();
  const locale = useLocale();
  const panes = useHistoryPanes();
  const id = conversation.conversationId;
  const name = conversation.title ?? (conversation.preview || t('web.history.untitled'));

  return (
    <>
      <Link
        href={`/history/${conversation.conversationId}${querySuffix}` as Route}
        aria-current={selected ? 'page' : undefined}
        onClick={(event) => {
          // A modified or middle click opens elsewhere and leaves this screen as it is.
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          onOpen?.(`/history/${conversation.conversationId}`);
        }}
        className={cn(
          'animate-in fade-in fill-mode-both duration-300 motion-reduce:animate-none',
          'relative flex flex-col gap-0.5 rounded-md px-3 py-2.5',
          'hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
          'duration-fast ease-standard transition-colors motion-reduce:transition-none',
          selected && 'bg-muted',
        )}
      >
        {selected ? (
          <span
            aria-hidden
            data-slot="history-row-active-bar"
            className="absolute inset-y-1.5 -left-1 z-10 w-1 rounded-full"
            style={{
              backgroundImage: `linear-gradient(180deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
            }}
          />
        ) : null}

        {/* Only this line shares the row with the `⋯`, which is pinned beside the
            time, so only this line makes room for it: 32px of button from 4px in,
            less the row's own 12px of padding. The preview and the meta line keep
            the full width — reserved on every line, the meta line ran out of room
            two facts early and its Minutes badge sat against the cut-off text. */}
        <div className={cn('flex min-w-0 items-baseline gap-3', panes && 'pr-7')}>
          {/* The title is what IDENTIFIES a conversation, so it is the ink line; the
            time only orders them. Until a title exists the first line stands in,
            at regular weight, so a guess at the topic reads differently from one. */}
          <p
            className={cn(
              'text-body min-w-0 flex-1 truncate',
              conversation.title ? 'font-medium' : undefined,
            )}
          >
            {name}
          </p>
          <time
            dateTime={conversation.startedAt}
            className="text-hint text-muted-foreground shrink-0 tabular-nums whitespace-nowrap"
          >
            {formatTime(conversation.startedAt, locale)}
          </time>
        </div>

        {conversation.title && conversation.preview ? (
          <p className="text-hint text-muted-foreground truncate">{conversation.preview}</p>
        ) : null}

        <div className="flex min-w-0 items-center gap-2">
          <ConversationMetaLine conversation={conversation} compact />
          {/* Only when minutes actually exist — the field is read from the relation,
            so this cannot claim a summary nobody ran. Never truncated away: the meta
            line beside it gives up its tail first. */}
          {conversation.hasMinutes ? (
            <Badge variant="secondary" className="shrink-0">
              {t('web.history.minutesReady')}
            </Badge>
          ) : null}
        </div>
      </Link>
      {panes ? (
        <ConversationActions
          placement="row"
          conversation={conversation}
          name={name}
          onRename={() => panes.renameFromList(id)}
          onDelete={() => panes.deleteFromList(id)}
        />
      ) : null}
    </>
  );
}
