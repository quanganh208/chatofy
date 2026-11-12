'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Conversation } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { deleteConversation, getConversation } from '@/clients/api-client';
import { useConversationPlayer } from '@/hooks/use-conversation-player';
import { useMinutes } from '@/hooks/use-minutes';
import { useTranslate } from '@/i18n/provider';
import { activeDurationMs } from './conversation-formatting';
import { ConversationDetailHeader } from './conversation-detail-header';
import { ConversationDetailLoading, ConversationDetailMissing } from './conversation-detail-states';
import { ConversationDetailTabs } from './conversation-detail-tabs';
import { ConversationRecordingControls } from './conversation-recording-controls';
import { useHistoryPanes } from './history-panes-context';
import { useConversationTitleEditing } from './use-conversation-title-editing';

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
 * the pane's content, and the minutes panel is a region on that ground too — on the
 * Minutes tab, where its Generate is the screen's one accent-filled control.
 * Play and `⋯` are outline; Delete's second press is `destructive`, which fills with
 * `live-fill`, not the accent. The open menu is the one elevated surface, and only
 * while it is open — two while its Download submenu is. Renaming swaps the title for
 * a field whose Save is outline, so it spends nothing either.
 */
export function ConversationDetail({ conversationId }: ConversationDetailProps) {
  const t = useTranslate();
  const router = useRouter();
  const panes = useHistoryPanes();
  const listHref = (panes?.listHref ?? '/history') as Route;
  // Stable for the layout's life, unlike `panes` itself, which changes with the
  // search term — so the fetch below can depend on it without refetching per keystroke.
  const cache = panes?.cache;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

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

  const { editing, startEditing, stopEditing, rename } = useConversationTitleEditing({
    conversationId,
    loaded: conversation !== null,
    missing,
    headingRef: heading,
    onRenamed: (stored) =>
      setConversation((current) => (current ? { ...current, ...stored } : current)),
  });

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
          <ConversationDetailHeader
            conversation={conversation}
            editing={editing}
            headingRef={heading}
            onRename={rename}
            onStartEditing={startEditing}
            onStopEditing={stopEditing}
            // `undefined` while the minutes are loading or failed to load, so a `.md`
            // export reads them itself and fails out loud. Handing it `null` there
            // would let it write the file without them as if none existed.
            minutes={minutes.loading || minutes.error ? undefined : minutes.minutes}
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
