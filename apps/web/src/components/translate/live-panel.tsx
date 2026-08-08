'use client';

import { useEffect } from 'react';
import { Loader2, Mic, Radio } from 'lucide-react';
import type { TranslationDirection } from '@chatofy/types';
import { useLiveTranslate } from '@/hooks/use-live-translate';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

  // Cleared on unmount as well as on stop — see the same effect in CascadePanel.
  useEffect(() => {
    onRunningChange(running);
    return () => onRunningChange(false);
  }, [running, onRunningChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="size-5" aria-hidden />
          {DIRECTION_TITLE[direction]}
        </CardTitle>
        <CardDescription>
          End-to-end speech translation. Unlike the cascade, this does not wait for you to finish a
          sentence — it starts speaking while you are still talking. Use headphones.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <DirectionToggle value={direction} onChange={onDirectionChange} disabled={running} />

        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="destructive" onClick={live.stop}>
              Stop
            </Button>
          ) : (
            <Button onClick={() => void live.start(direction)}>
              <Mic className="size-4" aria-hidden />
              Start
            </Button>
          )}
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            {live.status === 'connecting' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {live.status === 'live' && live.awaitingTranslation
              ? 'Translating…'
              : STATUS_LABEL[live.status]}
          </span>
        </div>

        {live.status === 'live' ? (
          <div className="flex flex-col gap-2">
            {/*
              A local level meter, not a server signal. Measured, the backend
              sends nothing for the first ~3.5 s of a sentence — the source
              transcript beats the audio by 280 ms and the target by 57 ms —
              so this is the only feedback that exists in that window. It says
              "we hear you", which is the question silence provokes. It does
              not, and cannot, make the model answer sooner.
            */}
            <div
              className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, live.level * 6) * 100)}
            >
              <div
                className="bg-primary h-full transition-[width] duration-75"
                style={{ width: `${Math.min(100, live.level * 600)}%` }}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              The translation trails you by about three and a half seconds — that is the model, not
              the connection.
            </p>
          </div>
        ) : null}

        {live.error ? (
          <p role="alert" className="text-destructive text-sm">
            {live.error}
          </p>
        ) : null}

        {languageMismatch ? (
          <p role="status" className="text-sm text-amber-600 dark:text-amber-500">
            Heard <strong>{live.detectedLanguage}</strong>, but this direction expects{' '}
            <strong>{EXPECTED_SOURCE[direction]}</strong>. The model detects the language itself;
            the translation may be wrong.
          </p>
        ) : null}

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              Heard
            </h2>
            <p className="min-h-6 text-sm whitespace-pre-wrap">
              {live.sourceText || <span className="text-muted-foreground">—</span>}
            </p>
          </div>
          <div>
            <h2 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              Translation
            </h2>
            <p className="min-h-6 whitespace-pre-wrap">
              {live.targetText || <span className="text-muted-foreground">—</span>}
            </p>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
