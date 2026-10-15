/**
 * The grid of video tiles: the local preview first, then one tile per remote peer.
 * A simple two-column flex wrap — one tile fills the width when alone, two per row
 * once a peer joins.
 */

import { View, StyleSheet } from 'react-native';
import { type MediaStream } from 'react-native-webrtc';
import { space } from '@chatofy/ui';
import { ParticipantTile } from './participant-tile';
import type { PeerState } from '@/conference/use-conference-native';

interface VideoGridProps {
  localStream: MediaStream;
  localLabel: string;
  localMuted: boolean;
  localVideoEnabled: boolean;
  peers: Map<string, PeerState>;
  /** Show the `translating…` badge on the local tile ([T1]→[T2] window). */
  localTranslating?: boolean;
  /** Localised badge text shown while `localTranslating` is true. */
  translatingLabel?: string;
}

export function VideoGrid({
  localStream,
  localLabel,
  localMuted,
  localVideoEnabled,
  peers,
  localTranslating = false,
  translatingLabel = '',
}: VideoGridProps) {
  const peerEntries = [...peers.entries()];
  // One tile alone spans the row; two or more share it half-and-half.
  const single = peerEntries.length === 0;
  const basis = single ? '100%' : '48%';

  return (
    <View style={styles.grid}>
      <View style={{ flexBasis: basis }}>
        <ParticipantTile
          stream={localStream}
          label={localLabel}
          mirror
          muted={localMuted}
          videoEnabled={localVideoEnabled}
          translating={localTranslating}
          translatingLabel={translatingLabel}
        />
      </View>
      {peerEntries.map(([socketId, peer]) => (
        <View key={socketId} style={{ flexBasis: '48%' }}>
          <ParticipantTile
            stream={peer.stream}
            label={peer.displayName}
            muted={peer.muted}
            videoEnabled={peer.videoEnabled}
            subtitle={peer.subtitle}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
