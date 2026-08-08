'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { DEFAULT_VOICE_GENDER, type TranslationDirection, type VoiceGender } from '@chatofy/types';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Hands-free conversation over the STT → translate → TTS cascade.
 *
 * There is no stop button by design: the turn ends when the speaker stops
 * talking. Pressing one costs half a second of human reaction time, which was
 * the single largest term in the measured latency of the turn-based page — that
 * page is still available at /translate/baseline as the comparison.
 *
 * A component rather than a page body, so the mode toggle can mount it beside
 * {@link LivePanel} without the two sharing a render. That separation is the
 * point: this path is the product and the live one is the experiment, and
 * nothing here should be able to break because that one changed.
 *
 * Its hook is only alive while this component is mounted, so switching modes
 * releases the microphone and the socket through the hook's own unmount
 * cleanup — there is no teardown to arrange from outside.
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

interface CascadePanelProps {
  direction: TranslationDirection;
  onDirectionChange: (direction: TranslationDirection) => void;
  /**
   * Reports whether a session is up, so the page can hold the mode toggle.
   *
   * Pushed out rather than lifted in: the status lives in this panel's hook, and
   * moving that hook to the page would mount both backends' hooks at once.
   */
  onRunningChange: (running: boolean) => void;
}

export function CascadePanel({ direction, onDirectionChange, onRunningChange }: CascadePanelProps) {
  const conversation = useStreamingTranslate();
  const [voiceGender, setVoiceGender] = useState<VoiceGender>(DEFAULT_VOICE_GENDER);

  const running = conversation.status !== 'idle';

  // Cleared on unmount as well as on stop: a panel that goes away is not
  // running, and leaving the flag set would strand the mode toggle disabled.
  useEffect(() => {
    onRunningChange(running);
    return () => onRunningChange(false);
  }, [running, onRunningChange]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{DIRECTION_TITLE[direction]}</CardTitle>
          <CardDescription>
            Speak naturally and pause. The translation plays back on its own — no button to press.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DirectionToggle value={direction} onChange={onDirectionChange} disabled={running} />

          <VoiceGenderToggle value={voiceGender} onChange={setVoiceGender} disabled={running} />

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="destructive" onClick={conversation.stop}>
                <MicOff /> End conversation
              </Button>
            ) : (
              <Button onClick={() => void conversation.start({ direction, voiceGender })}>
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
        </CardContent>
      </Card>

      <ConversationTranscript
        turns={conversation.turns}
        liveText={conversation.liveText}
        liveTranslation={conversation.liveTranslation}
      />
    </>
  );
}
