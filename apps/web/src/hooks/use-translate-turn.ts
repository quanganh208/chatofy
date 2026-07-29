'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';
import type { TranslateResponse, TranslationDirection, VoiceGender } from '@chatofy/types';
import { translate } from '@/clients/api-client';
import type { AudioRecording } from '@/hooks/use-audio-recorder';
import { blobToBase64 } from '@/lib/blob-to-base64';

/**
 * Part of the hook's exported contract (`runTranslate` parameter type).
 * @public
 */
export interface TranslateTurnOptions {
  direction: TranslationDirection;
  /** Which voice speaks the translation, in whichever language it comes out. */
  voiceGender: VoiceGender;
}

export interface UseTranslateTurn {
  loading: boolean;
  /** Seconds elapsed since the in-flight request started. */
  elapsed: number;
  result: TranslateResponse | null;
  error: string | null;
  /** Clear result/error, e.g. when a new audio source is picked. */
  reset: () => void;
  runTranslate: (recording: AudioRecording, options: TranslateTurnOptions) => Promise<void>;
}

/**
 * Request state machine for one turn-based translation: send recorded audio,
 * receive transcript + translation + synthesized speech, auto-play the result.
 */
export function useTranslateTurn(): UseTranslateTurn {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synchronous in-flight flag — `loading` state lags a render behind, so two
  // rapid calls could both observe loading === false and race.
  const inFlightRef = useRef(false);

  // Clear the elapsed-time interval if we unmount mid-request.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  function reset() {
    setResult(null);
    setError(null);
  }

  async function runTranslate(recording: AudioRecording, options: TranslateTurnOptions) {
    // Re-entrancy guard: a second call while one is in flight would race the
    // elapsed timer and the result state — correctness must not depend on the
    // caller disabling its button.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setResult(null);
    // Live elapsed counter so the wait reads as active work, not dead air.
    setElapsed(0);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    try {
      const audioBase64 = await blobToBase64(recording.blob);
      const res = await translate({
        audioBase64,
        audioMimeType: recording.mimeType,
        direction: options.direction,
        voiceGender: options.voiceGender,
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
      else if (err instanceof NetworkError)
        setError(err.timedOut ? 'Request timed out — try again' : 'Cannot reach the server');
      else setError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return { loading, elapsed, result, error, reset, runTranslate };
}
