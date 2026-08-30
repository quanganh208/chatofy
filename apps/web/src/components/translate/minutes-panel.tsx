'use client';

import { useState } from 'react';
import type { MeetingMinutes } from '@chatofy/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface MinutesPanelProps {
  /** The generated minutes, or null before the first pass. */
  minutes: MeetingMinutes | null;
  /** A generation pass is in flight. */
  loading: boolean;
  /** The last pass failed. */
  error: boolean;
  /** Whether there is a finished conversation to summarize. */
  canGenerate: boolean;
  /** Run (or re-run) a pass. Owner + turns are supplied by the parent. */
  onGenerate: () => void;
}

/**
 * Meeting minutes for a finished conversation: summary, key points, decisions,
 * and action items, with a button to generate or regenerate.
 *
 * Presentational — it owns no request state. The parent holds {@link useMinutes}
 * and passes the turns to summarize, so this component renders the same whether
 * it is driven live, from a test, or from a stored result.
 */
export function MinutesPanel({
  minutes,
  loading,
  error,
  canGenerate,
  onGenerate,
}: MinutesPanelProps) {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  const ready = minutes?.status === 'ready';

  const copy = async (): Promise<void> => {
    if (!minutes) return;
    await navigator.clipboard.writeText(toMarkdown(minutes, t));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('web.translate.minutesTitle')}</CardTitle>
        <div className="flex items-center gap-2">
          {ready && (
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {copied ? t('web.translate.minutesCopied') : t('web.translate.minutesCopy')}
            </Button>
          )}
          <Button size="sm" onClick={onGenerate} disabled={loading || !canGenerate}>
            {minutes ? t('web.translate.minutesRegenerate') : t('web.translate.minutesGenerate')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-muted-foreground">{t('web.translate.minutesGenerating')}</p>
        ) : error ? (
          <p className="text-destructive">{t('web.translate.minutesFailed')}</p>
        ) : !ready ? (
          <p className="text-muted-foreground">
            {canGenerate ? t('web.translate.minutesEmpty') : t('web.translate.minutesNeedsTurns')}
          </p>
        ) : (
          <MinutesBody minutes={minutes} />
        )}
      </CardContent>
    </Card>
  );
}

function MinutesBody({ minutes }: { minutes: MeetingMinutes }) {
  const t = useTranslate();
  return (
    <>
      <Section title={t('web.translate.minutesSummary')}>
        <p>{minutes.summary}</p>
      </Section>

      {minutes.keyPoints.length > 0 && (
        <Section title={t('web.translate.minutesKeyPoints')}>
          <ul className="list-disc pl-5">
            {minutes.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </Section>
      )}

      {minutes.decisions.length > 0 && (
        <Section title={t('web.translate.minutesDecisions')}>
          <ul className="list-disc pl-5">
            {minutes.decisions.map((decision, i) => (
              <li key={i}>{decision}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('web.translate.minutesActionItems')}>
        {minutes.actionItems.length === 0 ? (
          <p className="text-muted-foreground">{t('web.translate.minutesNoActionItems')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {minutes.actionItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span>{item.description}</span>
                {item.owner && (
                  <Badge variant="secondary">
                    {t('web.translate.minutesOwner')}: {item.owner}
                  </Badge>
                )}
                {item.dueDate && (
                  <Badge variant="outline">
                    {t('web.translate.minutesDue')}: {item.dueDate}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-label text-muted-foreground uppercase">{title}</p>
      <Separator />
      {children}
    </div>
  );
}

/** A copyable plain-markdown rendering of the minutes. */
function toMarkdown(minutes: MeetingMinutes, t: ReturnType<typeof useTranslate>): string {
  const lines: string[] = [`# ${t('web.translate.minutesTitle')}`, '', minutes.summary, ''];
  if (minutes.keyPoints.length) {
    lines.push(`## ${t('web.translate.minutesKeyPoints')}`);
    for (const point of minutes.keyPoints) lines.push(`- ${point}`);
    lines.push('');
  }
  if (minutes.decisions.length) {
    lines.push(`## ${t('web.translate.minutesDecisions')}`);
    for (const decision of minutes.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }
  lines.push(`## ${t('web.translate.minutesActionItems')}`);
  if (minutes.actionItems.length === 0) {
    lines.push(t('web.translate.minutesNoActionItems'));
  } else {
    for (const item of minutes.actionItems) {
      const suffix = [
        item.owner ? `${t('web.translate.minutesOwner')}: ${item.owner}` : null,
        item.dueDate ? `${t('web.translate.minutesDue')}: ${item.dueDate}` : null,
      ].filter(Boolean);
      lines.push(`- ${item.description}${suffix.length ? ` (${suffix.join(', ')})` : ''}`);
    }
  }
  return lines.join('\n');
}
