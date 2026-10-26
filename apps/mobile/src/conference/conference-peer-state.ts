/**
 * The remote-peer map the call screen renders, and the immutable updates the
 * room events apply to it. Each updater returns the previous map unchanged when
 * nothing changes, so React skips the render.
 */

import { MediaStream } from 'react-native-webrtc';

export interface PeerState {
  displayName: string;
  /** react-native-webrtc MediaStream, consumed by RTCView via `.toURL()`. */
  stream: MediaStream;
  /** Latest subtitle text for this peer; undefined when none active. */
  subtitle: string | undefined;
  /** Turn the showing subtitle belongs to, so a closing timer clears only its own turn. */
  subtitleTurnId: string | undefined;
  muted: boolean;
  videoEnabled: boolean;
}

export type PeerMap = Map<string, PeerState>;

/** Add a consumed track's stream to a peer's tile, creating the tile if needed. */
export function withPeerTrack(
  prev: PeerMap,
  socketId: string,
  stream: MediaStream,
  displayName: string,
): PeerMap {
  const next = new Map(prev);
  const entry = next.get(socketId);
  if (entry) {
    // A peer already has a tile (e.g. audio arrived first); merge in the new
    // track. A NEW MediaStream is built from the combined tracks so its
    // `toURL()` changes — adding a track to the existing stream in place keeps
    // the same URL, so RTCView never re-attaches and video stays black.
    const merged = new MediaStream();
    entry.stream.getTracks().forEach((t) => merged.addTrack(t));
    stream.getTracks().forEach((t) => merged.addTrack(t));
    next.set(socketId, { ...entry, stream: merged });
  } else {
    next.set(socketId, {
      stream,
      displayName,
      subtitle: undefined,
      subtitleTurnId: undefined,
      muted: false,
      videoEnabled: true,
    });
  }
  return next;
}

/** Drop a departed peer's tile and stop its tracks. */
export function withoutPeer(prev: PeerMap, socketId: string): PeerMap {
  const gone = prev.get(socketId);
  if (!gone) return prev;
  gone.stream.getTracks().forEach((t) => t.stop());
  const next = new Map(prev);
  next.delete(socketId);
  return next;
}

/** Apply a peer's own mute / camera change. */
export function withPeerMediaState(
  prev: PeerMap,
  socketId: string,
  change: { muted?: boolean; videoEnabled?: boolean },
): PeerMap {
  const entry = prev.get(socketId);
  if (!entry) return prev;
  const next = new Map(prev);
  next.set(socketId, {
    ...entry,
    muted: change.muted ?? entry.muted,
    videoEnabled: change.videoEnabled ?? entry.videoEnabled,
  });
  return next;
}

/** Show (or replace) a peer's subtitle for one turn. */
export function withPeerSubtitle(
  prev: PeerMap,
  socketId: string,
  turnId: string,
  text: string,
): PeerMap {
  const entry = prev.get(socketId);
  if (!entry) return prev;
  if (entry.subtitle === text && entry.subtitleTurnId === turnId) return prev;
  const next = new Map(prev);
  next.set(socketId, { ...entry, subtitle: text, subtitleTurnId: turnId });
  return next;
}

/** Clear a peer's subtitle only if it still shows `turnId`. */
export function withoutPeerSubtitle(prev: PeerMap, socketId: string, turnId: string): PeerMap {
  const entry = prev.get(socketId);
  if (!entry || entry.subtitleTurnId !== turnId) return prev;
  const next = new Map(prev);
  next.set(socketId, { ...entry, subtitle: undefined, subtitleTurnId: undefined });
  return next;
}
