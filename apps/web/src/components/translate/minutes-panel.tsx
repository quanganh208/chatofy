'use client';

import { useId, useState } from 'react';
import type { MinutesContent } from '@chatofy/types';
import { Badge, Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { minutesMarkdown } from '@/lib/minutes-markdown';

interface MinutesPanelProps {
  /**
   * The generated minutes, or null before the first pass. The content shape
   * rather than a conversation's minutes, so the conference end screen renders
   * a room's minutes through the same panel.
   */
  minutes: MinutesContent | null;
  /** A generation pass is in flight. */
  loading: boolean;
  /** The last pass failed. */
  error: boolean;
  /** Whether there is a stored conversation to summarize. */
  canGenerate: boolean;
  /**
   * Why generation is unavailable, when the reason is not "nothing was said".
   *
   * Optional because the default reason is the common one. On `/translate` the
   * blocker is usually that the conversation has not been SAVED yet — minutes
   * are drawn from the stored transcript — and telling a reader who just spoke
   * for ten minutes that there is nothing to summarize would be plainly false.
   */
  unavailableHint?: string;
  /**
   * Whether generate is this screen's action, or a second one on a screen that
   * already has one.
   *
   * Defaults to `accent`, because on `/history/[conversationId]` it IS the one
   * action and the surrounding screen is built around that. `/translate` passes
   * `quiet`: after a conversation ends, Start is back on screen, and two filled
   * controls at once was the single accent-budget violation this product had.
   */
  emphasis?: 'accent' | 'quiet';
  /**
   * Whether the panel names itself with a visible "Meeting minutes" heading.
   *
   * Defaults to true: on `/translate` and the meeting end screen nothing else on
   * the page says what this region is. The History Minutes tab passes false — the
   * selected tab already says it, and a second "Meeting minutes" directly under a
   * tab reading "Minutes" is a stutter. The section keeps the same accessible name
   * either way, so a screen reader landing on it hears what it is.
   */
  showTitle?: boolean;
  /**
   * The heading element for the visible title, so it slots into the page's
   * outline: `h2` where the page's only other heading is the topbar's `h1`
   * (`/translate`), `h3` under the end screen's own `h2`.
   */
  titleAs?: 'h2' | 'h3';
  /** Run (or re-run) a pass. The conversation is named by the parent. */
  onGenerate: () => void;
}

/**
 * Meeting minutes for a finished conversation: summary, key points, decisions,
 * and action items, with a button to generate or regenerate.
 *
 * A region on the page ground, not a card: every screen that shows it already
 * spends its elevation elsewhere or needs none, and the minutes are read, not
 * acted on as a unit. Hairlines carry the structure instead — one above the
 * header row where a title shows, one above each group.
 *
 * Presentational — it owns no request state. The parent holds {@link useMinutes}
 * and names the conversation to summarize, so this component renders the same
 * whether it is driven from `/translate` or from a history screen. Its strings
 * stay under `web.translate.*` on both: the keys are about minutes, not about a
 * route, and moving them would touch existing keys for no behavioural gain.
 */
export function MinutesPanel({
  minutes,
  loading,
  error,
  canGenerate,
  unavailableHint,
  emphasis = 'accent',
  showTitle = true,
  titleAs: Title = 'h2',
  onGenerate,
}: MinutesPanelProps) {
  const t = useTranslate();
  const titleId = useId();
  const [copied, setCopied] = useState(false);

  const ready = minutes?.status === 'ready';

  const copy = async (): Promise<void> => {
    if (!minutes) return;
    await navigator.clipboard.writeText(minutesMarkdown(minutes, t));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const actions = (
    <div className="flex items-center gap-2">
      {ready && (
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? t('web.translate.minutesCopied') : t('web.translate.minutesCopy')}
        </Button>
      )}
      <Button
        size="sm"
        variant={emphasis === 'accent' ? 'default' : 'outline'}
        onClick={onGenerate}
        disabled={loading || !canGenerate}
      >
        {minutes ? t('common.minutes.regenerate') : t('common.minutes.generate')}
      </Button>
    </div>
  );

  return (
    <section
      // A hook for the accent-budget gate, which has to prove the panel mounted:
      // with no card, its surface count is the same whether it renders or not.
      data-minutes-panel=""
      // Named by the visible heading when there is one, and by the same string
      // otherwise, so the region is announced identically on every screen.
      {...(showTitle
        ? { 'aria-labelledby': titleId }
        : { 'aria-label': t('common.minutes.title') })}
      className={
        showTitle ? 'border-hairline flex flex-col gap-4 border-t pt-4' : 'flex flex-col gap-4'
      }
    >
      {showTitle ? (
        // Wraps rather than squeezes: at phone width the title broke over two lines
        // beside its buttons. The title stays whole and the actions drop below it.
        <div className="flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-3">
          <Title id={titleId} className="text-body font-semibold whitespace-nowrap">
            {t('common.minutes.title')}
          </Title>
          {actions}
        </div>
      ) : (
        <div className="flex justify-end">{actions}</div>
      )}
      {loading ? (
        <p className="text-muted-foreground">{t('web.translate.minutesGenerating')}</p>
      ) : (
        <>
          {/* A failed regenerate leaves the stored ready copy readable (the
              server keeps it), so the failure is a line above it, not instead. */}
          {error && <p className="text-destructive">{t('common.minutes.failed')}</p>}
          {ready ? (
            <MinutesBody minutes={minutes} />
          ) : error ? null : (
            <p className="text-muted-foreground">
              {canGenerate
                ? t('web.translate.minutesEmpty')
                : (unavailableHint ?? t('web.translate.minutesNeedsTurns'))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function MinutesBody({ minutes }: { minutes: MinutesContent }) {
  const t = useTranslate();
  return (
    <>
      <Section title={t('common.minutes.summary')}>
        <p>{minutes.summary}</p>
      </Section>

      {minutes.keyPoints.length > 0 && (
        <Section title={t('common.minutes.keyPoints')}>
          <ul className="list-disc pl-5">
            {minutes.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </Section>
      )}

      {minutes.decisions.length > 0 && (
        <Section title={t('common.minutes.decisions')}>
          <ul className="list-disc pl-5">
            {minutes.decisions.map((decision, i) => (
              <li key={i}>{decision}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('common.minutes.actionItems')}>
        {minutes.actionItems.length === 0 ? (
          <p className="text-muted-foreground">{t('common.minutes.noActionItems')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {minutes.actionItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span>{item.description}</span>
                {item.owner && (
                  <Badge variant="secondary">
                    {t('common.minutes.owner')}: {item.owner}
                  </Badge>
                )}
                {item.dueDate && (
                  <Badge variant="outline">
                    {t('common.minutes.due')}: {item.dueDate}
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
    <div className="border-hairline flex flex-col gap-1 border-t pt-3">
      <p className="text-label text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}
