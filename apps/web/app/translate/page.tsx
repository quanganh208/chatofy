'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import type { TranslationDirection } from '@chatofy/types';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Hands-free conversation.
 *
 * There is no stop button by design: the turn ends when the speaker stops
 * talking. Pressing one costs half a second of human reaction time, which was
 * the single largest term in the measured latency of the turn-based page — that
 * page is still available at /translate/baseline as the comparison.
 */

const DIRECTION_TITLE: Record<TranslationDirection, string> = {
  vi_to_en: 'Vietnamese → English',
  en_to_vi: 'English → Vietnamese',
};

const STATUS_LABEL = {
  idle: 'Not listening',
  connecting: 'Connecting…',
  listening: 'Listening — just start talking',
  'hearing-speech': 'Hearing you…',
  translating: 'Translating…',
  playing: 'Speaking',
} as const;

export default function TranslatePage() {
  const conversation = useStreamingTranslate();
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');

  const running = conversation.status !== 'idle';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{DIRECTION_TITLE[direction]}</CardTitle>
          <CardDescription>
            Speak naturally and pause. The translation plays back on its own — no button to press.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DirectionToggle value={direction} onChange={setDirection} disabled={running} />

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="destructive" onClick={conversation.stop}>
                <MicOff /> End conversation
              </Button>
            ) : (
              <Button onClick={() => void conversation.start(direction)}>
                <Mic /> Start conversation
              </Button>
            )}

            <span className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              {conversation.status === 'connecting' || conversation.status === 'translating' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {conversation.status === 'playing' ? <Volume2 className="size-4" /> : null}
              {STATUS_LABEL[conversation.status]}
            </span>
          </div>

          {/* Mic level, and an explicit note when input is deliberately ignored
              so a muted microphone never looks like a broken one. */}
          <div className="flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-muted)]"
              role="presentation"
            >
              <div
                className="h-full bg-[var(--color-primary)] transition-[width] duration-75"
                style={{ width: `${Math.min(100, conversation.level * 300)}%` }}
              />
            </div>
            {conversation.muted ? (
              <span className="text-xs text-[var(--color-muted-foreground)]">
                mic off while speaking
              </span>
            ) : null}
          </div>

          {conversation.error ? (
            <p className="text-sm text-[var(--color-destructive)]">{conversation.error}</p>
          ) : null}

          <Link
            href="/translate/baseline"
            className="text-xs text-[var(--color-muted-foreground)] underline"
          >
            Turn-based baseline
          </Link>
        </CardContent>
      </Card>

      <ConversationTranscript
        turns={conversation.turns}
        liveText={conversation.liveText}
        liveTranslation={conversation.liveTranslation}
      />
    </main>
  );
}
