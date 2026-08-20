'use client';

import { Mic, Square } from 'lucide-react';
import type { TranslationDirection } from '@chatofy/types';
import { languageName } from '@/lib/language-name';
import { useLiveTranslate } from '@/hooks/use-live-translate';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { Button } from '@chatofy/ui/react';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
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
}

export function LivePanel({ direction, onDirectionChange }: LivePanelProps) {
  const live = useLiveTranslate();

  const running = live.status === 'connecting' || live.status === 'live';
  // The model detects the source itself, and the docs warn it struggles with
  // similar languages and heavy accents. Shown rather than swallowed: a speaker
  // whose language is being read wrong should see why the output is nonsense.
  const languageMismatch =
    live.detectedLanguage !== null && live.detectedLanguage !== EXPECTED_SOURCE[direction];

  const translating = live.status === 'live' && live.awaitingTranslation;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-prose text-body max-w-prose">
              Starts speaking before you finish your sentence, so the two of you can talk closer to
              normal speed. Wear headphones — it is talking while your microphone is still open.
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

        {live.error ? <Notice>{live.error}</Notice> : null}

        {languageMismatch ? (
          <Notice tone="warning">
            This sounds like <strong>{languageName(live.detectedLanguage)}</strong>, but the
            direction above expects <strong>{languageName(EXPECTED_SOURCE[direction])}</strong>.
            Switch the direction, or carry on — the translation may be wrong either way.
          </Notice>
        ) : null}
      </Card>

      <section className="flex flex-col gap-5" aria-label="Live translation">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
            Heard
          </h3>
          <p className="text-prose text-body min-h-6 whitespace-pre-wrap">
            {live.sourceText || '—'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
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
          {/* The largest thing on the surface, which is the whole point of the page.
              The scale stops at `text-title`, so dominance is reached by everything
              around it receding rather than by adding a step above 28. */}
          <p className="text-title min-h-10 font-medium whitespace-pre-wrap">
            {live.targetText || <span className="text-muted-foreground text-body">—</span>}
          </p>
        </div>
        {live.status === 'live' ? (
          <p className="text-muted-foreground text-hint">
            Runs about three and a half seconds behind you.
          </p>
        ) : null}
      </section>
    </div>
  );
}
