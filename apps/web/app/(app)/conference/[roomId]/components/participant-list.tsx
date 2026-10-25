'use client';

/**
 * Participant roster: self + all remote peers.
 *
 * Rendered as a region/list — NOT cards (design rule: cards are for things
 * you act on as a unit). Shows name, mic/cam state glyphs, source language.
 */

import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { PeerState } from '@/hooks/use-conference';

interface ParticipantListProps {
  selfName: string;
  selfMuted: boolean;
  selfVideoEnabled: boolean;
  selfLanguage: string;
  selfLabel: string;
  peers: Map<string, PeerState>;
  rosterTitle: string;
}

export function ParticipantList({
  selfName,
  selfMuted,
  selfVideoEnabled,
  selfLanguage,
  selfLabel,
  peers,
  rosterTitle,
}: ParticipantListProps) {
  const peerEntries = [...peers.entries()];

  return (
    <section aria-label={rosterTitle} className="flex flex-col gap-1">
      <h2 className="text-label text-textMuted px-2 pt-2 pb-1 font-semibold uppercase tracking-wide">
        {rosterTitle}
      </h2>

      {/* Self row */}
      <ParticipantRow
        name={`${selfName} (${selfLabel})`}
        muted={selfMuted}
        videoEnabled={selfVideoEnabled}
        language={selfLanguage}
      />

      {/* Remote peers */}
      {peerEntries.map(([socketId, peer]) => (
        <ParticipantRow
          key={socketId}
          name={peer.displayName}
          muted={peer.muted}
          videoEnabled={peer.videoEnabled}
          language={undefined}
        />
      ))}
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface ParticipantRowProps {
  name: string;
  muted: boolean;
  videoEnabled: boolean;
  language: string | undefined;
}

function ParticipantRow({ name, muted, videoEnabled, language }: ParticipantRowProps) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5">
      <span className="text-body text-text min-w-0 flex-1 truncate">{name}</span>

      {language && <span className="text-hint text-textMuted shrink-0">{language}</span>}

      <span className="text-textMuted shrink-0" aria-hidden>
        {muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
      </span>

      <span className="text-textMuted shrink-0" aria-hidden>
        {videoEnabled ? <Video className="size-3.5" /> : <VideoOff className="size-3.5" />}
      </span>
    </div>
  );
}
