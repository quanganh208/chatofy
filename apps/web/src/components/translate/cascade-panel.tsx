'use client';

import { useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { TranslateSettingsPanel } from '@/components/translate/translate-settings-panel';
import { Button } from '@chatofy/ui/react';
import { Card } from '@chatofy/ui/react';
import { Alert, AlertDescription } from '@chatofy/ui/react';
import { StatusIndicator, type StatusTone } from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import type { TranslateSettings } from '@/lib/translate-settings';

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
 *
 * It owns the settings panel's placement because `running` and the live volume
 * write both originate here; the settings VALUES belong to the page, which is the
 * only place allowed to call `useTranslateSettings`.
 */

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
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Reader for the saved volume — see `useStreamingTranslate`. */
  getVolume: () => number;
}

export function CascadePanel({ settings, onChange, getVolume }: CascadePanelProps) {
  // Stable, so the session built on first render keeps reading the live value.
  const readVolume = useCallback(() => getVolume(), [getVolume]);
  const conversation = useStreamingTranslate(readVolume);

  const running = conversation.status !== 'idle';

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* No heading naming the direction. The control below names it, and a
              screen that states the same fact twice makes the second one look like a
              different fact. */}
          <div className="flex flex-col gap-1">
            <p className="text-prose text-body max-w-prose">
              Speak naturally and pause. The translation plays back on its own — no button to press.
            </p>
          </div>
          {running ? (
            <Button variant="live" onClick={conversation.stop}>
              <MicOff aria-hidden /> End
            </Button>
          ) : (
            <Button
              onClick={() =>
                void conversation.start({
                  direction: settings.direction,
                  voiceGender: settings.voiceGender,
                  voiceOutput: settings.voiceOutput,
                  // Sent regardless of direction. The server hands it to whichever
                  // engine speaks the output language, and the one without a rate
                  // control ignores it — the UI disables the picker there so the
                  // choice is never silently inert, but the value itself is honest.
                  speed: settings.speed,
                  // ONE token, for the language about to be spoken. Settings keep
                  // one per language because the two engines share no vocabulary;
                  // the wire carries a single value because the server already
                  // knows the direction and two could disagree.
                  voice: settings.voice[directionLanguages(settings.direction).target],
                })
              }
            >
              <Mic aria-hidden /> Start conversation
            </Button>
          )}
        </div>

        <div className="border-hairline flex flex-wrap items-center gap-4 border-t pt-4">
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
        </div>

        {conversation.error ? (
          <Alert variant="live">
            <AlertDescription>{conversation.error}</AlertDescription>
          </Alert>
        ) : null}
      </Card>

      <TranslateSettingsPanel
        settings={settings}
        running={running}
        onChange={onChange}
        onVolumeChange={conversation.setVolume}
      />

      <ConversationTranscript
        turns={conversation.turns}
        liveTurns={conversation.liveTurns}
        running={running}
        layout={settings.transcriptLayout}
      />
    </div>
  );
}
