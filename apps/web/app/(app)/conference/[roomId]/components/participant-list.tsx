'use client';

/**
 * Participant roster: self + all remote peers.
 *
 * Rendered as a region/list — NOT cards (design rule: cards are for things
 * you act on as a unit). Each row has the same initials disc the video tile shows when a
 * camera is off, so a person looks the same in both places; the name, then what they speak;
 * then the state of their mic and camera.
 *
 * The state glyphs are NAMED ("Microphone muted"), not decorative: a glyph alone told a
 * screen-reader user nothing about who could be heard. A muted mic is drawn in the
 * destructive colour so it can be found at a glance in a long list.
 */

import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { PeerState } from '@/hooks/use-conference';
import { initials } from '../utils/initials';

interface StateLabels {
  micOn: string;
  micOff: string;
  camOn: string;
  camOff: string;
}

interface ParticipantListProps {
  selfName: string;
  selfMuted: boolean;
  selfVideoEnabled: boolean;
  selfLanguage: string;
  selfLabel: string;
  peers: Map<string, PeerState>;
  rosterTitle: string;
  stateLabels: StateLabels;
}

export function ParticipantList({
  selfName,
  selfMuted,
  selfVideoEnabled,
  selfLanguage,
  selfLabel,
  peers,
  rosterTitle,
  stateLabels,
}: ParticipantListProps) {
  const peerEntries = [...peers.entries()];
  const count = peerEntries.length + 1;

  return (
    <section aria-label={rosterTitle} className="flex flex-col gap-0.5">
      <h2 className="text-label text-muted-foreground flex items-baseline gap-1.5 px-3 pt-3 pb-1 font-semibold uppercase tracking-wide">
        {rosterTitle}
        <span className="font-normal tabular-nums" data-slot="roster-count">
          {count}
        </span>
      </h2>

      <ul className="flex flex-col">
        <ParticipantRow
          name={selfName}
          badge={selfLabel}
          muted={selfMuted}
          videoEnabled={selfVideoEnabled}
          language={selfLanguage}
          labels={stateLabels}
        />
        {peerEntries.map(([socketId, peer]) => (
          <ParticipantRow
            key={socketId}
            name={peer.displayName}
            muted={peer.muted}
            videoEnabled={peer.videoEnabled}
            labels={stateLabels}
          />
        ))}
      </ul>
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface ParticipantRowProps {
  name: string;
  badge?: string;
  muted: boolean;
  videoEnabled: boolean;
  language?: string;
  labels: StateLabels;
}

function ParticipantRow({
  name,
  badge,
  muted,
  videoEnabled,
  language,
  labels,
}: ParticipantRowProps) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-1.5">
      <span
        aria-hidden
        data-slot="roster-avatar"
        className="bg-muted text-foreground text-hint flex size-8 shrink-0 items-center justify-center rounded-full font-semibold"
      >
        {initials(name) || '?'}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{name}</span>
          {badge ? (
            <span className="text-hint text-muted-foreground shrink-0">({badge})</span>
          ) : null}
        </span>
        {language ? (
          <span className="text-hint text-muted-foreground truncate">{language}</span>
        ) : null}
      </span>

      <span
        role="img"
        aria-label={muted ? labels.micOff : labels.micOn}
        className={muted ? 'text-destructive shrink-0' : 'text-muted-foreground shrink-0'}
      >
        {muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
      </span>

      <span
        role="img"
        aria-label={videoEnabled ? labels.camOn : labels.camOff}
        className="text-muted-foreground shrink-0"
      >
        {videoEnabled ? (
          <Video className="size-4" aria-hidden />
        ) : (
          <VideoOff className="size-4" aria-hidden />
        )}
      </span>
    </li>
  );
}
