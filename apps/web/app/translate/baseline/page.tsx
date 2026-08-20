'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DEFAULT_VOICE_GENDER, type TranslationDirection, type VoiceGender } from '@chatofy/types';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import { useTranslateTurn } from '@/hooks/use-translate-turn';
import { AudioSourceControls } from '@/components/translate/audio-source-controls';
import { DirectionToggle } from '@chatofy/ui/react';
import { ResultCard } from '@/components/translate/result-card';
import { VoiceGenderToggle } from '@/components/translate/voice-gender-toggle';
import { Button } from '@chatofy/ui/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@chatofy/ui/react';
import { Alert, AlertDescription } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';

/**
 * Translate one recording: record or upload, press the button, hear the whole answer.
 *
 * Kept alongside the streaming page on purpose. It drives `POST /translate`, which
 * synthesizes an utterance in a single call, and is the measurement baseline the
 * streaming path's latency is reported against — deleting it would leave nothing to
 * compare to.
 *
 * It stays user-facing, so it stopped being named after a measurement method where a
 * person can see it — the heading now names what you do here instead. There is also a
 * way back: this page used to be a dead end, reachable only from a footer link that
 * described the experiment rather than the task. The superseded label is recorded in
 * `docs/design-guidelines.md` § Copy register rather than quoted here, since this file
 * is inside the sweep that removed it.
 */

export default function TranslatePage() {
  const recorder = useAudioRecorder();
  const turn = useTranslateTurn();
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');
  const [voiceGender, setVoiceGender] = useState<VoiceGender>(DEFAULT_VOICE_GENDER);

  function onTranslate() {
    if (!recorder.recording) return;
    void turn.runTranslate(recorder.recording, { direction, voiceGender });
  }

  return (
    <AppShell measure="reading" back={{ href: '/translate', label: 'Back to the translator' }}>
      <Card>
        <CardHeader>
          <CardTitle>Translate a recording</CardTitle>
          <CardDescription>
            {direction === 'vi_to_en'
              ? 'Record Vietnamese speech and hear the English translation.'
              : 'Record English speech and hear the Vietnamese translation.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DirectionToggle value={direction} onChange={setDirection} disabled={turn.loading} />

          <VoiceGenderToggle
            value={voiceGender}
            onChange={setVoiceGender}
            disabled={turn.loading}
          />

          <AudioSourceControls recorder={recorder} onSourceReplaced={turn.reset} />

          <Button onClick={onTranslate} disabled={!recorder.recording || turn.loading}>
            {/* `motion-reduce:hidden` rather than a stopped spinner: a spinner frozen
                mid-rotation reads as a hung request. The button's own label already
                carries the elapsed time, so removing the glyph loses nothing. */}
            {turn.loading ? <Loader2 className="animate-spin motion-reduce:hidden" /> : null}
            {turn.loading ? `Translating… ${turn.elapsed.toFixed(1)}s` : 'Translate'}
          </Button>

          {/* Both were bare coloured paragraphs with no role — a failed turn was
              on screen and silent to a screen reader. `Alert` supplies the
              `alert` role along with the treatment. */}
          {recorder.error ? (
            <Alert variant="live">
              <AlertDescription>Mic: {recorder.error}</AlertDescription>
            </Alert>
          ) : null}
          {turn.error ? (
            <Alert variant="live">
              <AlertDescription>{turn.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {turn.result ? <ResultCard result={turn.result} direction={direction} /> : null}
    </AppShell>
  );
}
