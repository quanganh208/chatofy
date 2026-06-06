'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, Upload } from 'lucide-react';
import { ApiClientError, ContractError } from '@chatofy/api-client';
import type { TranslateResponse } from '@chatofy/types';
import { translate } from '@/clients/api-client';
import { blobToBase64, useAudioRecorder } from '@/hooks/use-audio-recorder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';

function qualityLabel(q: number): string {
  if (q < 0.34) return 'Speed';
  if (q < 0.67) return 'Balanced';
  return 'Quality';
}

export default function TranslatePage() {
  const recorder = useAudioRecorder();
  const [quality, setQuality] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear the elapsed-time interval if we unmount mid-request.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    recorder.loadFile(file);
    setFileName(file.name);
    setResult(null);
    setError(null);
  }

  async function onTranslate() {
    if (!recorder.recording) return;
    setLoading(true);
    setError(null);
    setResult(null);
    // Live elapsed counter so the wait reads as active work, not dead air.
    setElapsed(0);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    try {
      const audioBase64 = await blobToBase64(recorder.recording.blob);
      const res = await translate({
        audioBase64,
        audioMimeType: recorder.recording.mimeType,
        quality,
      });
      setResult(res);
      // Auto-play the result once. The Translate click is the user gesture, so
      // playback is usually allowed; fall back silently to the visible controls.
      try {
        await new Audio(`data:${res.audioMimeType};base64,${res.audioBase64}`).play();
      } catch {
        /* autoplay blocked — user can press play on the controls */
      }
    } catch (err) {
      if (err instanceof ApiClientError) setError(`API error: ${err.error.message}`);
      else if (err instanceof ContractError) setError('Unexpected response shape from API');
      else setError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Vietnamese → English</CardTitle>
          <CardDescription>
            Record Vietnamese speech, pick speed vs quality, and hear the English translation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Audio source: record or upload a file */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {recorder.isRecording ? (
                <Button variant="destructive" onClick={recorder.stop}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setFileName(null);
                    void recorder.start();
                  }}
                >
                  <Mic /> {recorder.recording ? 'Re-record' : 'Record'}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={recorder.isRecording}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload /> Upload audio
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={onPickFile}
              />
            </div>
            <span className="text-sm text-[var(--color-muted-foreground)]">
              {recorder.isRecording
                ? 'Recording…'
                : fileName
                  ? `Loaded: ${fileName}`
                  : recorder.recording
                    ? 'Recorded — ready to translate'
                    : 'No audio yet — record or upload a file'}
            </span>

            {/* Live mic level while recording — turns the wait into visible activity. */}
            {recorder.isRecording ? (
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-muted)]"
                role="meter"
                aria-label="Microphone input level"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={Number(recorder.level.toFixed(2))}
              >
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-75"
                  style={{ width: `${Math.round(recorder.level * 100)}%` }}
                />
              </div>
            ) : null}
          </div>

          {/* Speed ↔ quality slider */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span>Speed</span>
              <span className="font-medium">
                {qualityLabel(quality)} ({quality.toFixed(2)})
              </span>
              <span>Quality</span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[quality]}
              onValueChange={(v) => setQuality(v[0] ?? 0.5)}
              disabled={loading}
            />
          </div>

          <Button onClick={onTranslate} disabled={!recorder.recording || loading}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? `Translating… ${elapsed.toFixed(1)}s` : 'Translate'}
          </Button>

          {recorder.error ? (
            <p className="text-sm text-[var(--color-destructive)]">Mic: {recorder.error}</p>
          ) : null}
          {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Vietnamese</p>
              <p>{result.sourceText}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--color-muted-foreground)]">English</p>
              <p>{result.targetText}</p>
            </div>
            <audio
              controls
              src={`data:${result.audioMimeType};base64,${result.audioBase64}`}
              className="w-full"
            />
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
