import { describe, expect, it, vi } from 'vitest';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import type { ConferenceSfuSignaling } from './conference-sfu-signaling.service';

function fakeSfu() {
  return {
    cleanupPeer: vi.fn(),
    cleanupRoom: vi.fn(),
  };
}

function makeRegistry() {
  const sfu = fakeSfu();
  const registry = new ConferenceRoomRegistry(
    sfu as unknown as ConferenceSfuSignaling,
  );
  return { sfu, registry };
}

const participant = {
  userId: 'u1',
  displayName: 'U',
  sourceLanguage: 'vi' as const,
  participantId: 'p1',
};

describe('ConferenceRoomRegistry', () => {
  it('shares one room between concurrent first joins', () => {
    const { registry } = makeRegistry();

    const a = registry.acquireForJoin('room');
    const b = registry.acquireForJoin('room');

    expect(a).toBe(b);
    expect(registry.getAllRooms()).toHaveLength(1);
  });

  it('starts a peer with no SFU sessions and nothing published or pulled', () => {
    const { registry } = makeRegistry();
    const room = registry.getOrCreateRoom('room');

    const peer = registry.addPeer(room, 's1', participant);

    expect(peer.pubSessionId).toBeUndefined();
    expect(peer.subSessionId).toBeUndefined();
    expect(peer.publishedTracks).toStrictEqual([]);
    expect(peer.pulled.size).toBe(0);
  });

  it('keeps an empty room open while a join holds it, and closes it once released', () => {
    const { registry } = makeRegistry();
    const held = registry.acquireForJoin('room');
    const aborted = registry.acquireForJoin('room');

    registry.releaseJoin(aborted);
    expect(registry.isLive(held)).toBe(true);

    registry.releaseJoin(held);
    expect(registry.getRoom('room')).toBeUndefined();
  });

  it('cleans up a leaving peer’s SFU tracks after taking it out of the room', () => {
    const { registry, sfu } = makeRegistry();
    const room = registry.getOrCreateRoom('room');
    const peer = registry.addPeer(room, 's1', participant);
    registry.addPeer(room, 's2', { ...participant, userId: 'u2' });
    sfu.cleanupPeer.mockImplementation((r: typeof room) => {
      expect(r.peers.has('s1')).toBe(false);
    });

    registry.removePeer(room, 's1');

    expect(sfu.cleanupPeer).toHaveBeenCalledWith(room, 's1', peer);
    expect(registry.isLive(room)).toBe(true);
  });

  it('drops the room once the last peer leaves', () => {
    const { registry } = makeRegistry();
    const room = registry.getOrCreateRoom('room');
    registry.addPeer(room, 's1', participant);

    registry.removePeer(room, 's1');

    expect(registry.getRoom('room')).toBeUndefined();
  });

  it('tells listeners, then cleans up every peer’s SFU tracks when the room ends', () => {
    const { registry, sfu } = makeRegistry();
    const closing = vi.fn();
    registry.onRoomClosing(closing);
    const room = registry.getOrCreateRoom('room');
    registry.addPeer(room, 's1', participant);
    sfu.cleanupRoom.mockImplementation((r: typeof room) => {
      expect(r.peers.size).toBe(1);
    });

    registry.endRoom('room');

    expect(closing).toHaveBeenCalledWith(room);
    expect(sfu.cleanupRoom).toHaveBeenCalledWith(room);
    expect(registry.getRoom('room')).toBeUndefined();
    expect(room.peers.size).toBe(0);
  });
});
