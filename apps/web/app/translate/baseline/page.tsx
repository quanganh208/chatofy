'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { TranslationDirection } from '@chatofy/types';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import { useTranslateTurn } from '@/hooks/use-translate-turn';
import { AudioSourceControls } from '@/components/translate/audio-source-controls';
import { DirectionToggle } from '@/components/translate/direction-toggle';
import { ResultCard } from '@/components/translate/result-card';
import { VoicePicker } from '@/components/translate/voice-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The turn-based baseline: record, press Translate, wait for the whole answer.
 *
 * Kept alongside the streaming page on purpose. It drives `POST /translate`,
 * which synthesizes an utterance in a single call, and is the measurement
 * baseline the streaming path's latency is reported against — deleting it would
 * leave nothing to compare to.
 */

const DIRECTION_TITLE: Record<TranslationDirection, string> = {
  vi_to_en: 'Vietnamese → English',
  en_to_vi: 'English → Vietnamese',
};

export default function TranslatePage() {
  const recorder = useAudioRecorder();
  const turn = useTranslateTurn();
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');
  const [voice, setVoice] = useState('Phạm Tuyên');

  function onTranslate() {
    if (!recorder.recording) return;
    void turn.runTranslate(recorder.recording, { direction, voice });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{DIRECTION_TITLE[direction]}</CardTitle>
          <CardDescription>
            {direction === 'vi_to_en'
              ? 'Record Vietnamese speech and hear the English translation.'
              : 'Record English speech and hear the Vietnamese translation (VieNeu voice).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DirectionToggle value={direction} onChange={setDirection} disabled={turn.loading} />

          {direction === 'en_to_vi' ? (
            <VoicePicker value={voice} onChange={setVoice} disabled={turn.loading} />
          ) : null}

          <AudioSourceControls recorder={recorder} onSourceReplaced={turn.reset} />

          <Button onClick={onTranslate} disabled={!recorder.recording || turn.loading}>
            {turn.loading ? <Loader2 className="animate-spin" /> : null}
            {turn.loading ? `Translating… ${turn.elapsed.toFixed(1)}s` : 'Translate'}
          </Button>

          {recorder.error ? (
            <p className="text-sm text-[var(--color-destructive)]">Mic: {recorder.error}</p>
          ) : null}
          {turn.error ? (
            <p className="text-sm text-[var(--color-destructive)]">{turn.error}</p>
          ) : null}
        </CardContent>
      </Card>

      {turn.result ? <ResultCard result={turn.result} direction={direction} /> : null}
    </main>
  );
}
