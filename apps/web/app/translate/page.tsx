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

type Direction = 'vi_to_en' | 'en_to_vi';

const DIRECTION_TITLE: Record<Direction, string> = {
  vi_to_en: 'Vietnamese → English',
  en_to_vi: 'English → Vietnamese',
};

// VieNeu preset voices (en→vi output). Kept in sync with the sidecar's presets;
// the sidecar also exposes GET /voices as the source of truth.
const VIENEU_VOICES = [
  'Trúc Ly',
  'Phạm Tuyên',
  'Thái Sơn',
  'Xuân Vĩnh',
  'Thanh Bình',
  'Minh Đức',
  'Ngọc Linh',
  'Đoan Trang',
  'Mai Anh',
  'Thục Đoan',
  'Minh Triết',
  'Thùy Dung',
  'Quang Sơn',
  'Ngọc Trân',
];

export default function TranslatePage() {
  const recorder = useAudioRecorder();
  const [quality, setQuality] = useState(0.5);
  const [direction, setDirection] = useState<Direction>('vi_to_en');
  const [voice, setVoice] = useState('Phạm Tuyên');
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
        direction,
        // Voice only applies to the Vietnamese (en→vi) output.
        ...(direction === 'en_to_vi' ? { voice } : {}),
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
          <CardTitle>{DIRECTION_TITLE[direction]}</CardTitle>
          <CardDescription>
            {direction === 'vi_to_en'
              ? 'Record Vietnamese speech, pick speed vs quality, and hear the English translation.'
              : 'Record English speech and hear the Vietnamese translation (VieNeu voice).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Direction toggle */}
          <div className="flex flex-col gap-2">
            <span className="text-sm">Direction</span>
            <div className="flex gap-2">
              <Button
                variant={direction === 'vi_to_en' ? 'default' : 'outline'}
                onClick={() => setDirection('vi_to_en')}
                disabled={loading}
              >
                VI → EN
              </Button>
              <Button
                variant={direction === 'en_to_vi' ? 'default' : 'outline'}
                onClick={() => setDirection('en_to_vi')}
                disabled={loading}
              >
                EN → VI
              </Button>
            </div>
          </div>

          {/* VieNeu voice picker — only for en→vi output */}
          {direction === 'en_to_vi' ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="vieneu-voice" className="text-sm">
                Vietnamese voice
              </label>
              <select
                id="vieneu-voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={loading}
                className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
              >
                {VIENEU_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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
              <p className="text-xs uppercase text-[var(--color-muted-foreground)]">
                {direction === 'vi_to_en' ? 'Vietnamese' : 'English'}
              </p>
              <p>{result.sourceText}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--color-muted-foreground)]">
                {direction === 'vi_to_en' ? 'English' : 'Vietnamese'}
              </p>
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
