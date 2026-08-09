'use client';

import { useEffect, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { DEFAULT_VOICE_GENDER, type TranslationDirection, type VoiceGender } from '@chatofy/types';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
import { Button } from '@/components/ui/button';
import { StatusIndicator, type StatusTone } from '@/components/ui/status-indicator';

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

/**
 * Colour per status, alongside the label rather than instead of it.
 *
 * `live` and `speaking` are red and green on the same dot, so the label is what
 * carries the difference for a colour blind reader — see `status-indicator.tsx`.
 */
const STATUS_TONE: Record<keyof typeof STATUS_LABEL, StatusTone> = {
  idle: 'idle',
  connecting: 'busy',
  listening: 'live',
  'hearing-speech': 'live',
  translating: 'busy',
  playing: 'speaking',
};

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
    <div className="flex flex-col gap-6">
      <section className="border-border bg-card flex flex-col gap-6 rounded-[var(--radius-lg)] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{DIRECTION_TITLE[direction]}</h2>
            <p className="text-muted-foreground max-w-prose text-sm">
              Speak naturally and pause. The translation plays back on its own — no button to press.
            </p>
          </div>
          {running ? (
            <Button variant="live" onClick={conversation.stop}>
              <MicOff aria-hidden /> End
            </Button>
          ) : (
            <Button onClick={() => void conversation.start({ direction, voiceGender })}>
              <Mic aria-hidden /> Start conversation
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-6">
          <DirectionToggle value={direction} onChange={onDirectionChange} disabled={running} />
          <VoiceGenderToggle value={voiceGender} onChange={setVoiceGender} disabled={running} />
        </div>

        <div className="border-border flex flex-wrap items-center gap-4 border-t pt-4">
          <StatusIndicator
            tone={STATUS_TONE[conversation.status]}
            label={STATUS_LABEL[conversation.status]}
          />
          {/* Mic level, and an explicit note when input is deliberately ignored
              so a muted microphone never looks like a broken one. */}
          <div
            className="bg-muted h-1.5 min-w-32 flex-1 overflow-hidden rounded-full"
            role="presentation"
          >
            <div
              className="bg-primary h-full transition-[width] duration-75 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, conversation.level * 300)}%` }}
            />
          </div>
          {conversation.muted ? (
            <span className="text-muted-foreground text-xs">mic off while speaking</span>
          ) : null}
        </div>

        {conversation.error ? (
          <p
            role="alert"
            className="bg-live-subtle text-foreground rounded-[var(--radius-md)] px-4 py-3 text-sm"
          >
            {conversation.error}
          </p>
        ) : null}
      </section>

      <ConversationTranscript
        turns={conversation.turns}
        liveText={conversation.liveText}
        liveTranslation={conversation.liveTranslation}
        running={running}
      />
    </div>
  );
}
