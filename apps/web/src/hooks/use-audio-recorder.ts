'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Chrome/Firefox produce webm/opus, which ElevenLabs Scribe accepts directly.
const PREFERRED_MIME = 'audio/webm;codecs=opus';

export interface AudioRecording {
  blob: Blob;
  /** Bare MIME type without codec params, e.g. "audio/webm". */
  mimeType: string;
}

export interface UseAudioRecorder {
  isRecording: boolean;
  recording: AudioRecording | null;
  error: string | null;
  /** Live mic input level (0..1) while recording; 0 when idle. */
  level: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  /** Use an uploaded audio file as the current recording. */
  loadFile: (file: File) => void;
}

// Fallback MIME by extension when a File has no/empty `type`.
const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

function mimeForFile(file: File): string {
  if (file.type) return file.type.split(';')[0] ?? file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

/** Records a single microphone utterance via MediaRecorder. */
export function useAudioRecorder(): UseAudioRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // Tear down the live level meter (RAF loop + audio graph). Idempotent.
  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  // Abort an in-flight recording WITHOUT producing a recording blob (its onstop
  // is detached first), then release the mic. Used when the current recording is
  // being replaced (reset/loadFile) so the live mic stream never lingers.
  const abortRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.ondataavailable = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  // Release everything on unmount (refs only — no state setters after unmount).
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Drive `level` from the live mic stream via an AnalyserNode (RMS of the
  // time-domain signal, scaled for visibility).
  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i]! - 128) / 128;
        sum += v * v;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setRecording(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startMeter(stream);
      const useMime = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : '';
      const recorder = new MediaRecorder(stream, useMime ? { mimeType: useMime } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const fullType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: fullType });
        setRecording({ blob, mimeType: fullType.split(';')[0] ?? 'audio/webm' });
        stopMeter();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsRecording(false);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      stopMeter();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not access microphone');
      setIsRecording(false);
    }
  }, [startMeter, stopMeter]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    stopMeter();
    abortRecorder();
    setRecording(null);
    setError(null);
  }, [stopMeter, abortRecorder]);

  const loadFile = useCallback(
    (file: File) => {
      stopMeter();
      abortRecorder();
      setError(null);
      setRecording({ blob: file, mimeType: mimeForFile(file) });
    },
    [stopMeter, abortRecorder],
  );

  return { isRecording, recording, error, level, start, stop, reset, loadFile };
}

/** Encode a Blob's bytes to a base64 string (no data-url prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
