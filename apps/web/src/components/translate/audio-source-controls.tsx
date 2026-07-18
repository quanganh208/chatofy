'use client';

import { useRef, useState } from 'react';
import { Mic, Square, Upload } from 'lucide-react';
import type { UseAudioRecorder } from '@/hooks/use-audio-recorder';
import { Button } from '@/components/ui/button';

interface AudioSourceControlsProps {
  recorder: UseAudioRecorder;
  /** Called when an uploaded file replaces the current audio source. */
  onFilePicked?: () => void;
}

/** Audio source section: record/re-record, upload a file, status line, live mic meter. */
export function AudioSourceControls({ recorder, onFilePicked }: AudioSourceControlsProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    recorder.loadFile(file);
    setFileName(file.name);
    onFilePicked?.();
  }

  return (
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
  );
}
