'use client';

import { Mic, MicOff, Pause } from 'lucide-react';
import { Button, StatusIndicator, type StatusTone } from '@chatofy/ui/react';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import { MicMeter } from '@/components/translate/mic-meter';
import { ElapsedClock } from '@/components/translate/elapsed-clock';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * The conversation's readouts and its actions, for the two places that drive it:
 * the page's dock, and the fullscreen stage's bar.
 *
 * One component for both rather than a copy in each, because the rules about
 * which button shows in which state are the subtle part — Pause hidden while
 * connecting, the accent moving to Resume while paused — and a second copy is
 * where one of them would quietly go missing. Exactly one of the two renders the
 * actions at a time (`cascade-panel.tsx`), so the screen still has one Start.
 */

/**
 * Status → dictionary key. The words moved to `@chatofy/i18n`; this table keeps
 * naming which status says which thing, which is the part that is about this
 * component rather than about language.
 */
const STATUS_KEY = {
  idle: 'web.translate.notListening',
  connecting: 'web.translate.connecting',
  listening: 'web.translate.listening',
  'hearing-speech': 'web.translate.hearingYou',
  translating: 'web.translate.translating',
  playing: 'web.translate.speaking',
  paused: 'web.translate.paused',
  finishing: 'web.translate.finishing',
} as const;

/**
 * Colour per status, alongside the label rather than instead of it.
 *
 * `live` and `speaking` are red and green on the same dot, so the label is what
 * carries the difference for a colour blind reader — see `status-indicator.tsx`.
 */
const STATUS_TONE: Record<keyof typeof STATUS_KEY, StatusTone> = {
  idle: 'idle',
  connecting: 'busy',
  listening: 'live',
  'hearing-speech': 'live',
  translating: 'busy',
  playing: 'speaking',
  // The one running state that gets the resting dot. `live` would pulse at a
  // reader whose microphone is off, which is the single thing this indicator
  // exists to be honest about.
  paused: 'idle',
  // Still speaking, so it keeps the speaking tone: the loudspeaker is the one
  // thing still happening, and this is the same green it had a moment ago.
  finishing: 'speaking',
};

/** Status, level, and — while running — the elapsed time. Readouts only. */
export function SessionReadouts({
  conversation,
  className,
}: {
  conversation: Pick<UseStreamingTranslate, 'status' | 'level' | 'startedAt' | 'pauses'>;
  className?: string;
}) {
  const t = useTranslate();
  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      <StatusIndicator
        tone={STATUS_TONE[conversation.status]}
        label={t(STATUS_KEY[conversation.status])}
      />
      <MicMeter level={conversation.level} />
      {conversation.status !== 'idle' ? (
        <ElapsedClock startedAt={conversation.startedAt} pauses={conversation.pauses} />
      ) : null}
    </div>
  );
}

/**
 * Start, or Pause/Resume and End while a conversation is open.
 *
 * Two buttons while running, which is the one place the dock's layout bends. They
 * are a pair rather than two controls: both end the microphone, and they differ
 * only in whether the conversation survives it.
 *
 * `compact` drops the hint line under Start and the stretch-to-fill below `sm`:
 * the fullscreen bar is one row, and its readers already chose a context before
 * they went there.
 */
export function SessionActions({
  conversation,
  onStart,
  awaitingContext,
  contextUnready,
  compact = false,
}: {
  conversation: Pick<UseStreamingTranslate, 'status' | 'pause' | 'resume' | 'end'>;
  onStart: () => void;
  /** The stored context is still loading — Start waits for it. */
  awaitingContext: boolean;
  /** The stored context failed to load — Start is allowed, and says so. */
  contextUnready: boolean;
  compact?: boolean;
}) {
  const t = useTranslate();
  const { status } = conversation;
  const running = status !== 'idle';
  const size = compact ? 'default' : 'lg';
  const fill = compact ? 'rounded-full' : 'flex-1 rounded-full sm:flex-none';

  if (running) {
    return (
      <>
        {/* Outline while listening, accent while paused. The screen's one filled
            control is whatever the reader has to do next, and a paused
            conversation is waiting on exactly one thing.

            Neither appears while finishing: the conversation is already ending,
            so there is nothing to pause and nothing to come back to. End stays,
            and a second press there cuts the tail.

            Nor while connecting, for the mirror reason: no microphone is open yet
            to turn off. That window is exactly as long as the browser's
            permission prompt, and a Pause standing there through it was a control
            that could only do nothing. End stays there too and cancels the
            pending start — `conversation-session.ts` says how. */}
        {status === 'connecting' || status === 'finishing' ? null : status === 'paused' ? (
          <Button size={size} className={fill} onClick={conversation.resume}>
            <Mic aria-hidden /> {t('web.translate.resume')}
          </Button>
        ) : (
          <Button variant="outline" size={size} className={fill} onClick={conversation.pause}>
            <Pause aria-hidden /> {t('web.translate.pause')}
          </Button>
        )}
        {/* `end`, not `stop`: the sentence just finished still gets spoken. `stop`
            is for the page going away. */}
        <Button variant="live" size={size} className={fill} onClick={conversation.end}>
          <MicOff aria-hidden /> {t('web.translate.end')}
        </Button>
      </>
    );
  }

  const start = (
    <Button
      size={size}
      className={compact ? 'rounded-full' : 'w-full rounded-full sm:w-auto'}
      disabled={awaitingContext}
      onClick={onStart}
    >
      <Mic aria-hidden /> {t('web.translate.startConversation')}
    </Button>
  );
  if (compact) return start;

  return (
    <div className="flex w-full flex-col items-center gap-2 sm:w-auto">
      {start}
      {/* Words explain the gate, and only while it applies. `awaitingContext` is
          transient — the list settles in one request — and `contextUnready` is
          not a gate at all: Start stays pressable, and this is what stops that
          from being silent. */}
      {awaitingContext ? (
        <span className="text-muted-foreground text-hint">{t('web.translate.contextLoading')}</span>
      ) : contextUnready ? (
        <span className="text-muted-foreground text-hint">
          {t('web.translate.contextUnavailable')}
        </span>
      ) : null}
    </div>
  );
}
