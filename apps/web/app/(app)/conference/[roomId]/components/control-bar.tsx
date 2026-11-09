'use client';

/**
 * In-call control bar: mic toggle, camera toggle, Leave.
 *
 * Design rules:
 * - Leave is the ONE accent-filled (bg-primary / variant="default") control on
 *   the in-call screen. Mic and camera are ghost/outline toggles.
 * - Leave calls leave() then navigates back to /conference.
 */

import type { ReactNode } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@chatofy/ui/react';

interface ControlBarProps {
  localMuted: boolean;
  localVideoEnabled: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  muteMicLabel: string;
  unmuteMicLabel: string;
  disableCameraLabel: string;
  enableCameraLabel: string;
  leaveLabel: string;
  /** Personal controls beside the camera (captions and sound). Never the accent. */
  extra?: ReactNode;
}

export function ControlBar({
  localMuted,
  localVideoEnabled,
  onToggleMute,
  onToggleVideo,
  onLeave,
  muteMicLabel,
  unmuteMicLabel,
  disableCameraLabel,
  enableCameraLabel,
  leaveLabel,
  extra,
}: ControlBarProps) {
  return (
    <div className="border-border flex items-center justify-center gap-3 border-t px-4 py-3">
      {/* Mic toggle — outline, reflects current mute state */}
      <Button
        variant="outline"
        size="icon"
        onClick={onToggleMute}
        aria-label={localMuted ? unmuteMicLabel : muteMicLabel}
        aria-pressed={localMuted}
      >
        {localMuted ? (
          <MicOff className="size-4" aria-hidden />
        ) : (
          <Mic className="size-4" aria-hidden />
        )}
      </Button>

      {/* Camera toggle — outline, reflects current video state */}
      <Button
        variant="outline"
        size="icon"
        onClick={onToggleVideo}
        aria-label={localVideoEnabled ? disableCameraLabel : enableCameraLabel}
        aria-pressed={!localVideoEnabled}
      >
        {localVideoEnabled ? (
          <Video className="size-4" aria-hidden />
        ) : (
          <VideoOff className="size-4" aria-hidden />
        )}
      </Button>

      {extra}

      {/* Leave — THE ONE accent-filled control on this screen */}
      <Button variant="default" onClick={onLeave}>
        {leaveLabel}
      </Button>
    </div>
  );
}
