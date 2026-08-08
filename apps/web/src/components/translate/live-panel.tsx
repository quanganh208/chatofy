'use client';

import { useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
import type { TranslationDirection } from '@chatofy/types';
import { useLiveTranslate } from '@/hooks/use-live-translate';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { Button } from '@/components/ui/button';
import { StatusIndicator, type StatusTone } from '@/components/ui/status-indicator';

/**
 * Continuous speech-to-speech, the other half of the mode toggle on /translate.
 *
 * A sibling component of {@link CascadePanel}, never a branch inside it. The
 * cascade is the product and this is the experiment being compared against it,
 * so the two share a route and a socket path but not a render: only one is
 * mounted at a time, and a change to this file cannot reach that one.
 *
 * What is visibly different here: the translation starts arriving while you are
 * still talking. The model has no notion of a turn — it translates continuously
 * and trails a few seconds behind — so there is no "listening / translating /
 * speaking" cycle to show, only a conversation that is running or not.
 *
 * Which is why this panel has a stage rather than a transcript: there is one
 * sentence in flight and it is being rewritten as you speak. The translation is
 * set large and the source small above it, because the translation is what
 * someone is here to read.
 */

const DIRECTION_TITLE: Record<TranslationDirection, string> = {
  vi_to_en: 'Vietnamese → English',
  en_to_vi: 'English → Vietnamese',
};

const EXPECTED_SOURCE: Record<TranslationDirection, string> = {
  vi_to_en: 'vi',
  en_to_vi: 'en',
};

const STATUS_LABEL = {
  idle: 'Not listening',
  connecting: 'Opening the session…',
  live: 'Live — keep talking, the translation follows',
  stopped: 'Stopped',
} as const;

const STATUS_TONE: Record<keyof typeof STATUS_LABEL, StatusTone> = {
  idle: 'idle',
  connecting: 'busy',
  live: 'live',
  stopped: 'idle',
};

interface LivePanelProps {
  direction: TranslationDirection;
  onDirectionChange: (direction: TranslationDirection) => void;
  /** Reports whether a session is up, so the page can hold the mode toggle. */
  onRunningChange: (running: boolean) => void;
}

export function LivePanel({ direction, onDirectionChange, onRunningChange }: LivePanelProps) {
  const live = useLiveTranslate();

  const running = live.status === 'connecting' || live.status === 'live';
  // The model detects the source itself, and the docs warn it struggles with
  // similar languages and heavy accents. Shown rather than swallowed: a speaker
  // whose language is being read wrong should see why the output is nonsense.
  const languageMismatch =
    live.detectedLanguage !== null && live.detectedLanguage !== EXPECTED_SOURCE[direction];

  const translating = live.status === 'live' && live.awaitingTranslation;

  // Cleared on unmount as well as on stop — see the same effect in CascadePanel.
  useEffect(() => {
    onRunningChange(running);
    return () => onRunningChange(false);
  }, [running, onRunningChange]);

  return (
    <div className="flex flex-col gap-6">
      <section className="border-border bg-card flex flex-col gap-6 rounded-[var(--radius-lg)] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{DIRECTION_TITLE[direction]}</h2>
            <p className="text-muted-foreground max-w-prose text-sm">
              End-to-end speech translation. Unlike the cascade, this does not wait for you to
              finish a sentence — it starts speaking while you are still talking. Use headphones.
            </p>
          </div>
          {running ? (
            <Button variant="live" onClick={live.stop}>
              <Square aria-hidden /> Stop
            </Button>
          ) : (
            <Button onClick={() => void live.start(direction)}>
              <Mic aria-hidden /> Start
            </Button>
          )}
        </div>

        <DirectionToggle value={direction} onChange={onDirectionChange} disabled={running} />

        <div className="border-border flex flex-wrap items-center gap-4 border-t pt-4">
          <StatusIndicator
            tone={translating ? 'busy' : STATUS_TONE[live.status]}
            label={translating ? 'Translating…' : STATUS_LABEL[live.status]}
          />
          {live.status === 'live' ? (
            /*
              A local level meter, not a server signal. Measured, the backend
              sends nothing for the first ~3.5 s of a sentence — the source
              transcript beats the audio by 280 ms and the target by 57 ms —
              so this is the only feedback that exists in that window. It says
              "we hear you", which is the question silence provokes. It does
              not, and cannot, make the model answer sooner.
            */
            <div
              className="bg-muted h-1.5 min-w-32 flex-1 overflow-hidden rounded-full"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, live.level * 6) * 100)}
            >
              <div
                className="bg-primary h-full transition-[width] duration-75 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, live.level * 600)}%` }}
              />
            </div>
          ) : null}
        </div>

        {live.error ? (
          <p
            role="alert"
            className="bg-live-subtle text-foreground rounded-[var(--radius-md)] px-4 py-3 text-sm"
          >
            {live.error}
          </p>
        ) : null}

        {languageMismatch ? (
          <p
            role="status"
            className="bg-warning-subtle text-foreground rounded-[var(--radius-md)] px-4 py-3 text-sm"
          >
            Heard <strong>{live.detectedLanguage}</strong>, but this direction expects{' '}
            <strong>{EXPECTED_SOURCE[direction]}</strong>. The model detects the language itself;
            the translation may be wrong.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-5" aria-label="Live translation">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Heard
          </h3>
          <p className="text-muted-foreground min-h-6 text-sm whitespace-pre-wrap">
            {live.sourceText || '—'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Translation
          </h3>
          {/*
            Deliberately NOT a live region. The model rewrites this text token by
            token as it hears more, so every mutation would queue another polite
            announcement and a screen reader would read half-sentences over each
            other without ever finishing one. The status indicator above already
            announces that a translation is arriving, which is the part that is
            not visible on its own.
          */}
          <p className="min-h-8 text-[22px] leading-snug font-medium whitespace-pre-wrap">
            {live.targetText || <span className="text-muted-foreground text-base">—</span>}
          </p>
        </div>
        {live.status === 'live' ? (
          <p className="text-muted-foreground text-xs">
            The translation trails you by about three and a half seconds — that is the model, not
            the connection.
          </p>
        ) : null}
      </section>
    </div>
  );
}
