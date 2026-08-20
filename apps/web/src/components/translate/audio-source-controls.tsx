'use client';

import { useRef, useState } from 'react';
import { Mic, Square, Upload } from 'lucide-react';
import type { UseAudioRecorder } from '@/hooks/use-audio-recorder';
import { Button } from '@/components/ui/button';

interface AudioSourceControlsProps {
  recorder: UseAudioRecorder;
  /**
   * Called whenever the audio source is being replaced (file picked or a new
   * recording started) — lets the page clear a stale result immediately.
   */
  onSourceReplaced?: () => void;
}

/** Audio source section: record/re-record, upload a file, status line, live mic meter. */
export function AudioSourceControls({ recorder, onSourceReplaced }: AudioSourceControlsProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    recorder.loadFile(file);
    setFileName(file.name);
    onSourceReplaced?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {recorder.isRecording ? (
          <Button variant="live" onClick={recorder.stop}>
            <Square /> Stop
          </Button>
        ) : (
          <Button
            onClick={() => {
              setFileName(null);
              // A stale result from the previous take must not linger while
              // the replacement is being recorded.
              onSourceReplaced?.();
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
      <span className="text-prose text-body">
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
          className="bg-muted h-2 w-full overflow-hidden rounded-full"
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(recorder.level.toFixed(2))}
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-75 motion-reduce:transition-none"
            style={{ width: `${Math.round(recorder.level * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
