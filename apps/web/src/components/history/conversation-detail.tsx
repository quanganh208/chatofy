'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Conversation } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { deleteConversation, getConversation, renameConversation } from '@/clients/api-client';
import { useConversationPlayer } from '@/hooks/use-conversation-player';
import { useMinutes } from '@/hooks/use-minutes';
import { useLocale, useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { activeDurationMs } from './conversation-formatting';
import { ConversationActions } from './conversation-actions-menu';
import { ConversationDetailLoading, ConversationDetailMissing } from './conversation-detail-states';
import { ConversationDetailTabs } from './conversation-detail-tabs';
import { ConversationMetaLine } from './conversation-meta-line';
import { ConversationRecordingControls } from './conversation-recording-controls';
import { ConversationTitleEditor } from './conversation-title-editor';
import { useHistoryPanes } from './history-panes-context';

interface ConversationDetailProps {
  conversationId: string;
}

/**
 * One stored conversation: a header that names it and holds its controls, then its
 * transcript and its minutes as two tabs.
 *
 * The reading pane beside the list on a wide screen, and the whole page on a narrow
 * one. The back link is drawn only in the second case — it hides itself from the
 * `@5xl` container width the History layout switches at, because beside the list it
 * would be a link to the list you can already see.
 *
 * ## Surfaces and the accent budget
 *
 * Nothing here is a card. The header is text on the page ground, the transcript is
 * the pane's content, and the only elevated surface is the minutes panel — on the
 * Minutes tab, where its Generate is also the screen's one accent-filled control.
 * Play and `⋯` are outline; Delete's second press is `destructive`, which fills with
 * `live-fill`, not the accent. The open menu is the one other surface, and only
 * while it is open — two while its Download submenu is. Renaming swaps the title for
 * a field whose Save is outline, so it spends nothing either.
 */
export function ConversationDetail({ conversationId }: ConversationDetailProps) {
  const t = useTranslate();
  const locale = useLocale();
  const router = useRouter();
  const panes = useHistoryPanes();
  const listHref = (panes?.listHref ?? '/history') as Route;
  // Stable for the layout's life, unlike `panes` itself, which changes with the
  // search term — so the fetch below can depend on it without refetching per keystroke.
  const cache = panes?.cache;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  // Opt-in: on a history screen an existing summary is exactly what the reader came
  // for. The translate panel passes nothing and still fetches nothing.
  const minutes = useMinutes(conversationId);
  // The element's ref lives HERE, with the component that owns the player, and is
  // handed to the hook. See `useConversationPlayer` for why neither a hook-returned
  // ref nor element-in-state survives the React Compiler rules.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const player = useConversationPlayer(conversationId, audioRef);

  // The scrubber's span, from the STORED duration rather than the media element:
  // `MediaRecorder` writes no Duration into the WebM header, so `audio.duration`
  // commonly reads `Infinity`. Active time, not wall time, for the fallback, because
  // the recording paused with the conversation.
  const totalMs =
    conversation?.audioDurationMs ?? (conversation ? activeDurationMs(conversation) : 0);

  // Reset all three when the id changes, or a second `conversationId` inherits the
  // first one's verdict — a conversation that loads fine drawn as "no longer here",
  // under the previous one's title. The History layout keys this component by id,
  // so a switch remounts it; this keeps the guarantee for any caller that does not.
  // Adjusted during render, so the stale verdict is never committed even for a frame.
  const [shownFor, setShownFor] = useState(conversationId);
  if (shownFor !== conversationId) {
    setShownFor(conversationId);
    setLoading(true);
    setMissing(false);
    setConversation(null);
    setEditing(false);
  }

  // Opened in the place of one just deleted: the delete removed the control that
  // had focus, so the next conversation's title takes it, where a reader expects
  // to be — not `<body>`.
  //
  // Taken by the not-found state too. Left pending there, the request would be
  // served by whichever conversation loads NEXT — one opened much later, by a
  // reader who is somewhere else entirely.
  const heading = useRef<HTMLHeadingElement>(null);
  const gone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Settled first: the loading branch has neither element to focus, and
    // `missing` and `loading` are set from different callbacks.
    if (loading || (!conversation && !missing)) return;
    if (!panes?.takeFocusRequest()) return;
    (conversation ? heading : gone).current?.focus();
  }, [conversation, missing, loading, panes]);

  // Rename chosen on this conversation's list row: the row opened it, and its
  // header does the editing. Adjusted during render, so the title never draws one
  // frame before the field replaces it; the request is spent once editing is on.
  const renameRequested = panes?.renameRequest === conversationId;
  if (conversation && renameRequested && !editing) setEditing(true);
  useEffect(() => {
    if (editing && renameRequested) panes?.takeRenameRequest();
  }, [editing, renameRequested, panes]);

  // Back onto the title when the field goes, whichever way it went — the control
  // that had focus is gone with it.
  const returnToTitle = useRef(false);
  useEffect(() => {
    if (editing || !returnToTitle.current) return;
    returnToTitle.current = false;
    heading.current?.focus();
  }, [editing]);

  const stopEditing = () => {
    returnToTitle.current = true;
    setEditing(false);
  };

  const rename = async (title: string) => {
    const { conversation: stored } = await renameConversation(conversationId, { title });
    // The header from the stored summary, the turns from what is already here; the
    // list row and the export cache take the same summary, so nothing refetches.
    setConversation((current) => (current ? { ...current, ...stored } : current));
    panes?.renamed(stored);
    stopEditing();
  };

  useEffect(() => {
    let cancelled = false;
    getConversation(conversationId)
      .then(({ conversation: loaded }) => {
        if (cancelled) return;
        setConversation(loaded);
        cache?.remember(loaded);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, cache]);

  const remove = async () => {
    await deleteConversation(conversationId);
    // Out of the list first, so the screen landed on is not still offering it — on
    // a wide `/history` the newest REMAINING conversation is what opens next.
    panes?.cache.forget(conversationId);
    panes?.forget(conversationId);
    // `replace`: Back must not return to a conversation that no longer exists, and
    // a delete on `/history` must not stack a second `/history` on the first.
    router.replace(listHref);
  };

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start @5xl:hidden">
        <Link href={listHref}>
          <ArrowLeft aria-hidden /> {t('web.history.back')}
        </Link>
      </Button>

      {loading ? (
        <ConversationDetailLoading />
      ) : missing || !conversation ? (
        <div ref={gone} tabIndex={-1} className="outline-none">
          <ConversationDetailMissing />
        </div>
      ) : (
        <>
          {/* The row's own title and facts, following the reader in: this is what
              confirms WHICH conversation opened. An `h2`, because the topbar holds
              the screen's `h1`. */}
          <header className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3">
            {/* While renaming, the title block takes the header's whole first row:
                beside the player its 12rem basis squeezed the field until Cancel
                wrapped alone. The player and `⋯` move to the row below, still in
                reach and in the same tab order. */}
            <div
              className={cn(
                'flex min-w-0 flex-col gap-1.5',
                editing ? 'basis-full' : 'flex-[1_1_12rem]',
              )}
            >
              {editing ? (
                <ConversationTitleEditor
                  title={conversation.title}
                  onSave={rename}
                  onCancel={stopEditing}
                />
              ) : (
                <h2
                  ref={heading}
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
              minutes={minutes.loading ? undefined : minutes.minutes}
              onRename={() => setEditing(true)}
              onDelete={remove}
              leading={
                conversation.hasRecording ? (
                  <ConversationRecordingControls
                    player={player}
                    audioRef={audioRef}
                    totalMs={totalMs}
                  />
                ) : null
              }
            />
          </header>

          <ConversationDetailTabs
            conversation={conversation}
            minutes={minutes}
            // Only when there is something to seek. Without a recording the gutter
            // renders as plain text rather than as a button that would do nothing.
            onSeek={conversation.hasRecording ? player.seekTo : undefined}
          />
        </>
      )}
    </div>
  );
}
