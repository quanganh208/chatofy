/**
 * Which remote peer each receiving transceiver carries.
 *
 * A `mid` belongs to the connection that negotiated it: the SFU hands this
 * client a publication on a mid of its own choosing, and the subscribe reply
 * says which peer and kind that mid is. The track event only knows the mid.
 */
import type { ConferenceMediaPublish, ConferenceMediaSubscribeReply } from '@chatofy/types/events';

type SubscribedMid = ConferenceMediaSubscribeReply['mids'][number];
type PublishedTrack = ConferenceMediaPublish['tracks'][number];

export type MidPeer = Pick<SubscribedMid, 'socketId' | 'kind'>;
export type MidMap = Map<string, MidPeer>;

/** The slice of an `RTCRtpTransceiver` publishing reads, so tests need no browser. */
export interface PublishingTransceiver {
  readonly mid: string | null;
  readonly sender: { readonly track: { readonly kind: string } | null };
}

export function recordMids(map: MidMap, mids: readonly SubscribedMid[]): void {
  for (const { mid, socketId, kind } of mids) map.set(mid, { socketId, kind });
}

export function peerForMid(map: MidMap, mid: string | null): MidPeer | undefined {
  return mid === null ? undefined : map.get(mid);
}

/** Forget a departed peer's mids; returns the mids removed. */
export function dropPeer(map: MidMap, socketId: string): string[] {
  const removed: string[] = [];
  for (const [mid, peer] of map) {
    if (peer.socketId !== socketId) continue;
    map.delete(mid);
    removed.push(mid);
  }
  return removed;
}

/**
 * The `tracks` of a publish request. Mids exist only once the offer is the
 * local description, so a null mid means publish was called too early.
 */
export function publishTracksFromTransceivers(
  transceivers: readonly PublishingTransceiver[],
): PublishedTrack[] {
  return transceivers.map(({ mid, sender }) => {
    if (mid === null) throw new Error('publishing transceiver has no mid');
    const kind = sender.track?.kind;
    if (kind !== 'audio' && kind !== 'video') {
      throw new Error(`publishing transceiver ${mid} carries no audio or video track`);
    }
    return { mid, kind };
  });
}
