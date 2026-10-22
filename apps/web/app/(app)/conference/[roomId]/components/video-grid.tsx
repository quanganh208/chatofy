'use client';

/**
 * Responsive video grid for the in-call screen.
 *
 * Layout via `gridColsClass` (1→full, 2→2-up, 3-4→2×2, 5-6→3×2).
 * Each tile: <video> bound to the stream, name label, camera-off placeholder,
 * muted-mic glyph, and subtitle overlay slot.
 * The local tile is always rendered with `muted` to prevent echo.
 */

import { useEffect, useRef } from 'react';
import { Loader2, MicOff, VideoOff } from 'lucide-react';
import type { PeerState } from '@/hooks/use-conference';
import { SubtitleOverlay } from './subtitle-overlay';
import { computeGridLayout } from '../utils/video-layout';

// ─── Video tile ───────────────────────────────────────────────────────────────

interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  muted: boolean;
  videoEnabled: boolean;
  subtitle?: string;
  /** Whether to mute the audio track (always true for the local tile). */
  audioMuted?: boolean;
  /** Show the "translating…" badge on this tile. Local tile only. */
  translating?: boolean;
  /** Localised badge text, e.g. "Translating…". Required when translating=true. */
  translatingLabel?: string;
  /** Extra classes from the grid layout (col-span, col-start, etc.). */
  tileClassName?: string;
}

function VideoTile({
  stream,
  label,
  muted,
  videoEnabled,
  subtitle,
  audioMuted = false,
  translating = false,
  translatingLabel = '',
  tileClassName = '',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !stream) return;
    try {
      videoRef.current.srcObject = stream;
    } catch {
      // happy-dom and some environments reject non-native MediaStream objects;
      // silently skip — the video will remain blank in tests.
    }
  }, [stream]);

  // Active-speaker signal: remote tile with a live subtitle, or local tile while
  // translating. Uses the `speaking` state token — a readout ring, not accent fill.
  const isActiveSpeaker = Boolean(subtitle) || translating;

  return (
    <div
      className={[
        'bg-surfaceRaised relative overflow-hidden rounded-lg',
        isActiveSpeaker ? 'ring-2 ring-speaking' : '',
        tileClassName,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Video element — hidden (but still active) when camera is off */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={audioMuted}
          className={['h-full w-full object-cover', videoEnabled ? 'block' : 'hidden'].join(' ')}
        />
      )}

      {/* Camera-off placeholder */}
      {!videoEnabled && (
        <div className="text-textMuted flex h-full w-full flex-col items-center justify-center gap-2">
          <VideoOff className="size-8 opacity-60" aria-hidden />
        </div>
      )}

      {/* Name label — bottom-left */}
      <div className="absolute bottom-0 left-0 flex items-center gap-1 px-2 py-1">
        <span className="text-label rounded bg-black/50 px-1 text-white">{label}</span>
        {muted && (
          <span className="rounded bg-black/50 p-0.5">
            <MicOff className="size-3 text-white" aria-hidden />
          </span>
        )}
      </div>

      {/* Translating badge — top-right, readout only, no accent fill */}
      {translating && (
        <div
          className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/50 px-2 py-0.5"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="text-textMuted size-3 animate-spin" aria-hidden />
          <span className="text-label text-textMuted">{translatingLabel}</span>
        </div>
      )}

      {/* Subtitle overlay — bottom-center, above name */}
      <SubtitleOverlay subtitle={subtitle} />
    </div>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

interface VideoGridProps {
  localStream: MediaStream | null;
  localLabel: string;
  localMuted: boolean;
  localVideoEnabled: boolean;
  peers: Map<string, PeerState>;
  /** i18n label for "Waiting for others" placeholder */
  waitingLabel: string;
  /** Whether the local speaker is currently being translated ([T1]→[T2] window). */
  localTranslating?: boolean;
  /** i18n badge text shown on the local tile while localTranslating is true. */
  translatingLabel?: string;
}

export function VideoGrid({
  localStream,
  localLabel,
  localMuted,
  localVideoEnabled,
  peers,
  waitingLabel,
  localTranslating = false,
  translatingLabel = '',
}: VideoGridProps) {
  const peerEntries = [...peers.entries()];
  const showWaiting = peerEntries.length === 0;
  // Include the waiting placeholder as a tile slot for layout purposes.
  const totalCount = (localStream ? 1 : 0) + (showWaiting ? 1 : peerEntries.length);
  const layout = computeGridLayout(Math.max(totalCount, 1));

  let tileIndex = 0;

  return (
    <div className={`${layout.containerClass} h-full auto-rows-fr gap-2`}>
      {/* Local tile — audio always muted to prevent echo */}
      {localStream && (
        <VideoTile
          stream={localStream}
          label={localLabel}
          muted={localMuted}
          videoEnabled={localVideoEnabled}
          audioMuted
          translating={localTranslating}
          translatingLabel={translatingLabel}
          tileClassName={layout.tiles[tileIndex++]?.className}
        />
      )}

      {/* Remote peer tiles */}
      {peerEntries.map(([socketId, peer]) => (
        <VideoTile
          key={socketId}
          stream={peer.stream}
          label={peer.displayName}
          muted={peer.muted}
          videoEnabled={peer.videoEnabled}
          subtitle={peer.subtitle}
          audioMuted={false}
          tileClassName={layout.tiles[tileIndex++]?.className}
        />
      ))}

      {/* Empty-room placeholder */}
      {showWaiting && (
        <div
          className={[
            'text-textMuted flex items-center justify-center rounded-lg border border-dashed border-border text-body',
            layout.tiles[tileIndex]?.className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {waitingLabel}
        </div>
      )}
    </div>
  );
}
