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
import { initials } from '../utils/initials';
import { DAWN_GRADIENT } from '../../components/dawn-glow';

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
  /** Whether this reader wants captions at all. */
  captions?: boolean;
  captionSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** How loud this tile's own audio is, 0 to 1. Never raises the local tile, which stays muted. */
  volume?: number;
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
  captions = true,
  captionSize = 'md',
  volume = 1,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && !audioMuted) videoRef.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume, audioMuted, stream]);

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

  // "Enabled" is what the person asked for; a track is what is actually arriving. A
  // person who joined audio only is "enabled" with nothing to show, and that tile
  // used to be an empty rectangle.
  const hasPicture = videoEnabled && (stream?.getVideoTracks().length ?? 0) > 0;

  return (
    <div
      className={[
        'bg-muted relative overflow-hidden rounded-lg @2xl:aspect-video',
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
          className={['h-full w-full object-cover', hasPicture ? 'block' : 'hidden'].join(' ')}
        />
      )}

      {/* Camera-off placeholder */}
      {!hasPicture && (
        <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2">
          {/* The lobby's camera-off look: a dawn ring around a neutral disc, so a
              person looks the same before and after they join. */}
          <div aria-hidden className="rounded-full p-1" style={{ backgroundImage: DAWN_GRADIENT }}>
            <div
              data-slot="tile-avatar"
              className="bg-card text-foreground text-title flex size-20 items-center justify-center rounded-full font-semibold"
            >
              {initials(label) || '?'}
            </div>
          </div>
          {!videoEnabled && <VideoOff className="size-4 opacity-60" aria-hidden />}
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
          <Loader2 className="text-muted-foreground size-3 animate-spin" aria-hidden />
          <span className="text-label text-muted-foreground">{translatingLabel}</span>
        </div>
      )}

      {/* Subtitle overlay — bottom-center, above name */}
      {captions ? <SubtitleOverlay subtitle={subtitle} size={captionSize} /> : null}
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
  captions?: boolean;
  captionSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** Volume of the other people's own voices, 0 to 1. */
  originalVolume?: number;
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
  captions = true,
  captionSize = 'md',
  originalVolume = 1,
}: VideoGridProps) {
  const peerEntries = [...peers.entries()];
  const showWaiting = peerEntries.length === 0;
  // Include the waiting placeholder as a tile slot for layout purposes.
  const totalCount = (localStream ? 1 : 0) + (showWaiting ? 1 : peerEntries.length);
  const layout = computeGridLayout(Math.max(totalCount, 1));

  let tileIndex = 0;

  return (
    // Rows fill the stage on a narrow one. From 42rem the tiles keep the camera's 16:9
    // shape and the rows sit in the middle, so two people side by side are two
    // landscape tiles rather than two tall strips that crop a webcam on both sides.
    <div
      className={`${layout.containerClass} h-full auto-rows-fr gap-2 @2xl:auto-rows-auto @2xl:content-center`}
    >
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
          captions={captions}
          captionSize={captionSize}
          volume={originalVolume}
          tileClassName={layout.tiles[tileIndex++]?.className}
        />
      ))}

      {/* Empty-room placeholder */}
      {showWaiting && (
        <div
          className={[
            'text-muted-foreground flex items-center justify-center rounded-lg border border-dashed border-border text-body',
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
