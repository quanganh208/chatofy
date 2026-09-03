'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Conversation } from '@chatofy/types';
import { Button, Card, CardContent } from '@chatofy/ui/react';
import { HistoryTranscript } from '@/components/history/history-transcript';
import { DeleteConversationButton } from '@/components/history/delete-conversation-button';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { deleteConversation, getConversation } from '@/clients/api-client';
import { useMinutes } from '@/hooks/use-minutes';
import { useLocale, useTranslate } from '@/i18n/provider';

interface ConversationDetailProps {
  conversationId: string;
}

/**
 * One stored conversation: its transcript, its minutes, and a delete.
 *
 * ## The accent budget
 *
 * Exactly one accent-filled control, and it is `MinutesPanel`'s generate button,
 * which is default-variant. So the budget is already spent before this component
 * adds anything: back is ghost, delete is destructive-outline. That is why they
 * are the variants they are, rather than a styling preference.
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/history">
            <ArrowLeft aria-hidden /> {t('web.history.back')}
          </Link>
        </Button>
        {conversation ? (
          <DeleteConversationButton
            onConfirm={async () => {
              await deleteConversation(conversationId);
              router.push('/history');
            }}
          />
        ) : null}
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <p className="text-muted-foreground">{t('web.history.loading')}</p>
          </CardContent>
        </Card>
      ) : missing || !conversation ? (
        <Card>
          <CardContent>
            <p className="text-muted-foreground">{t('web.history.notFound')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <HistoryTranscript turns={conversation.turns} />
          <MinutesPanel
            minutes={minutes.minutes}
            loading={minutes.loading}
            error={minutes.error}
            canGenerate={conversation.turns.length > 0}
            onGenerate={() => void minutes.generate(conversationId, locale)}
          />
        </>
      )}
    </div>
  );
}
