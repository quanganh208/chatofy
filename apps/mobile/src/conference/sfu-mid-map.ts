/**
 * Pure bookkeeping for the two SFU peer connections: which remote peer a
 * receiving `mid` belongs to, and which `{ mid, kind }` pairs a publish offer
 * announces.
 *
 * A `mid` belongs to the connection that negotiated it, so a remote peer's
 * track arrives on this client's receive connection under a `mid` only the
 * subscribe reply can explain. The reply's `mids` are recorded here before its
 * offer is applied, because react-native-webrtc fires `track` events before
 * `setRemoteDescription` resolves.
 *
 * Pure (no React Native imports), so it runs under node:test.
 */

export type SfuTrackKind = 'audio' | 'video';

export interface SfuMidOwner {
  socketId: string;
  kind: SfuTrackKind;
}

/** Receiving `mid` → the remote peer and track kind it carries. */
export type SfuMidMap = Map<string, SfuMidOwner>;

/** Record the owners of the `mids` a subscribe reply announced. */
export function recordMids(
  map: SfuMidMap,
  mids: readonly { mid: string; socketId: string; kind: SfuTrackKind }[],
): void {
  for (const { mid, socketId, kind } of mids) map.set(mid, { socketId, kind });
}

/** The remote peer a receiving `mid` belongs to, or undefined when unknown. */
export function peerForMid(map: SfuMidMap, mid: string): SfuMidOwner | undefined {
  return map.get(mid);
}

/** Forget every `mid` owned by a departed peer and return the ones removed. */
export function dropPeer(map: SfuMidMap, socketId: string): string[] {
  const removed: string[] = [];
  for (const [mid, owner] of map) {
    if (owner.socketId === socketId) removed.push(mid);
  }
  for (const mid of removed) map.delete(mid);
  return removed;
}

/** The slice of an RTCRtpTransceiver the publish step reads. */
export interface PublishTransceiver {
  mid: string | null;
  sender: { track: { kind: string } | null };
}

/**
 * The `{ mid, kind }` list a publish request carries, read from the send
 * connection's transceivers after `setLocalDescription`. Throws when a
 * transceiver has no `mid` yet or carries no audio/video track: publishing
 * then would announce a track the SFU cannot match to the offer.
 */
export function publishTracksFromTransceivers(
  transceivers: readonly PublishTransceiver[],
): { mid: string; kind: SfuTrackKind }[] {
  return transceivers.map((t) => {
    if (t.mid === null) throw new Error('publish transceiver has no mid');
    const kind = t.sender.track?.kind;
    if (kind !== 'audio' && kind !== 'video') {
      throw new Error(`publish transceiver ${t.mid} carries no audio or video track`);
    }
    return { mid: t.mid, kind };
  });
}
