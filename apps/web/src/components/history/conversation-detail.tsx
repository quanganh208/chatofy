'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileX2 } from 'lucide-react';
import type { Conversation } from '@chatofy/types';
import { Button, Card, CardContent, Skeleton } from '@chatofy/ui/react';
import { HistoryTranscript } from '@/components/history/history-transcript';
import { DeleteConversationButton } from '@/components/history/delete-conversation-button';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { deleteConversation, getConversation } from '@/clients/api-client';
import { useMinutes } from '@/hooks/use-minutes';
import { useLocale, useTranslate } from '@/i18n/provider';
import { durationMinutes, formatTime } from './conversation-formatting';
import { DirectionLabel } from './direction-label';

interface ConversationDetailProps {
  conversationId: string;
}

/**
 * One stored conversation: its transcript, its minutes, and a delete.
 *
 * ## Two elevated surfaces, and they earn it
 *
 * The transcript and the minutes are each a thing you act on as a unit — read,
 * copy, regenerate — so each is a card. That is the ceiling for a screen,
 * exactly spent, which is why nothing else here is one: the header facts are a
 * line, the not-found state is a region on the page ground, and the delete sits
 * under a hairline.
 *
 * ## The accent budget
 *
 * Exactly one accent-filled control, and it is `MinutesPanel`'s generate button,
 * which is default-variant. So the budget is already spent before this component
 * adds anything: back is ghost, and delete is outline until it is confirmed and
 * `destructive` after — a variant that fills with `live-fill`, not the accent.
 * That is why they are the variants they are, rather than a styling preference.
 * The loading and not-found states carry no accent at all, which is under the
 * ceiling rather than over it.
 *
 * ## Delete comes after the thing it destroys
 *
 * It used to sit second on the screen, in the header row opposite "back" — above
 * the transcript the reader opened the page for. It is now below both records,
 * past the point where you have finished reading, and the consequence sentence
 * is shown BEFORE the first press rather than only after it. That sentence lives
 * here rather than inside the button so it does not appear and disappear with
 * the two-step; the button keeps the failure alert, which has to be inserted to
 * be spoken.
 *
 * `MinutesPanel` is reused unchanged — it was already presentational. Its strings
 * stay under `web.translate.*`: the keys are about minutes, not about the route,
 * and moving them would touch existing keys for no behavioural gain.
 */
export function ConversationDetail({ conversationId }: ConversationDetailProps) {
  const t = useTranslate();
  const locale = useLocale();
  const router = useRouter();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  // Opt-in: on a history screen an existing summary is exactly what the reader
  // came for. The translate panel passes nothing and still fetches nothing.
  const minutes = useMinutes(conversationId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getConversation(conversationId)
      .then(({ conversation: loaded }) => {
        if (!cancelled) setConversation(loaded);
      })
      .catch(() => {
        // One message for every failure: a foreign id and an absent one answer
        // identically by design, so the screen must not claim to tell them apart.
        if (!cancelled) setMissing(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/history">
            <ArrowLeft aria-hidden /> {t('web.history.back')}
          </Link>
        </Button>
        {/* The row's own facts, following the reader in: arriving from a list of
            previews, this is what confirms WHICH conversation opened. */}
        {conversation ? (
          <p className="text-muted-foreground text-hint flex flex-wrap items-center gap-1.5">
            {new Date(conversation.startedAt).toLocaleDateString(locale, { dateStyle: 'medium' })}
            <Dot />
            {formatTime(conversation.startedAt, locale)}
            <Dot />
            <DirectionLabel direction={conversation.direction} />
            <Dot />
            {t('web.history.turnCount', { count: conversation.turnCount })}
            <Dot />
            {t('web.history.duration', { minutes: durationMinutes(conversation) })}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingRecords label={t('web.history.loading')} />
      ) : missing || !conversation ? (
        // A state of the page, not an object on it — so it is drawn on the
        // ground, and it no longer shares one plain-paragraph card with the
        // loading state, which made the two failures look identical.
        <div className="flex flex-col items-center gap-3 px-2 pt-8 pb-6 text-center">
          <FileX2 aria-hidden className="text-border-strong size-16" strokeWidth={1.25} />
          <p className="text-body font-semibold">{t('web.history.notFound')}</p>
          <p className="text-muted-foreground text-prose max-w-[46ch]">
            {t('web.history.notFoundBody')}
          </p>
        </div>
      ) : (
        <>
          <HistoryTranscript turns={conversation.turns} />
          {/* `canGenerate` is unconditional. A stored conversation has at least
              one turn — the write schema refuses an empty one — so the panel's
              "nothing to summarize" state is unreachable from this route. */}
          <MinutesPanel
            minutes={minutes.minutes}
            loading={minutes.loading}
            error={minutes.error}
            canGenerate
            onGenerate={() => void minutes.generate(conversationId, locale)}
          />

          <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-muted-foreground text-hint max-w-[48ch]">
              {t('web.history.deleteConfirm')}
            </p>
            <DeleteConversationButton
              onConfirm={async () => {
                await deleteConversation(conversationId);
                router.push('/history');
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

/**
 * The first load, in the shape of the two records it becomes.
 *
 * Not a sentence in a card: the loading and the not-found states used the same
 * paragraph two branches apart, so for the first frame a conversation that was
 * gone looked exactly like one that was arriving. The sentence is still said, to
 * screen readers, where `aria-busy` alone would leave a blank silence.
 */
function LoadingRecords({ label }: { label: string }) {
  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Card>
        <CardContent>
          <ul className="flex flex-col gap-4">
            {[0, 1, 2].map((turn) => (
              <li key={turn} className="border-hairline flex flex-col gap-1.5 border-l-2 pl-4">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-3.5 w-full max-w-[40ch]" />
                <Skeleton className="h-4 w-full max-w-[34ch]" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-full max-w-[44ch]" />
        </CardContent>
      </Card>
    </div>
  );
}
