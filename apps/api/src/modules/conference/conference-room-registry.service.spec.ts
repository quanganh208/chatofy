import { describe, expect, it, vi } from 'vitest';
import {
  ConferenceRoomRegistry,
  RoomClosedError,
} from './conference-room-registry.service';
import type { ConferenceWorkerService } from './conference-worker.service';

function fakeWorker() {
  let died: (() => void) | undefined;
  const routers: { close: ReturnType<typeof vi.fn> }[] = [];
  let release: () => void = () => undefined;
  let gate = Promise.resolve();
  const worker = {
    onWorkerDied: (listener: () => void) => {
      died = listener;
    },
    getWorker: () => ({
      createRouter: async () => {
        await gate;
        const router = { close: vi.fn(), rtpCapabilities: {} };
        routers.push(router);
        return router;
      },
    }),
  } as unknown as ConferenceWorkerService;
  return {
    worker,
    routers,
    die: () => died?.(),
    /** Hold router creation until `release()` is called. */
    hold: () => {
      gate = new Promise((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
  };
}

const participant = {
  userId: 'u1',
  displayName: 'U',
  sourceLanguage: 'vi' as const,
  participantId: 'p1',
};

describe('ConferenceRoomRegistry', () => {
  it('shares one router between concurrent first joins of a room', async () => {
    const w = fakeWorker();
    const registry = new ConferenceRoomRegistry(w.worker);

    const [a, b] = await Promise.all([
      registry.getOrCreateRoom('room'),
      registry.getOrCreateRoom('room'),
    ]);

    expect(a).toBe(b);
    expect(w.routers).toHaveLength(1);
  });

  it('discards a router whose room was ended while it was being created', async () => {
    const w = fakeWorker();
    const registry = new ConferenceRoomRegistry(w.worker);
    w.hold();

    const opening = registry.getOrCreateRoom('room');
    registry.endRoom('room');
    w.release();

    await expect(opening).rejects.toBeInstanceOf(RoomClosedError);
    expect(w.routers[0]?.close).toHaveBeenCalled();
    expect(registry.getRoom('room')).toBeUndefined();
  });

  it('tells listeners and drops every room when the worker dies', async () => {
    const w = fakeWorker();
    const registry = new ConferenceRoomRegistry(w.worker);
    const closing = vi.fn();
    registry.onRoomClosing(closing);
    const room = await registry.getOrCreateRoom('room');
    registry.addPeer(room, 's1', participant);

    w.die();

    expect(closing).toHaveBeenCalledWith(room, 'media_restart');
    expect(registry.getAllRooms()).toHaveLength(0);
    expect(room.peers.size).toBe(0);
  });

  it('keeps an empty room open while a join holds it, and closes it once released', async () => {
    const w = fakeWorker();
    const registry = new ConferenceRoomRegistry(w.worker);
    const held = await registry.acquireForJoin('room');
    const aborted = await registry.acquireForJoin('room');

    registry.releaseJoin(aborted);
    expect(registry.isLive(held)).toBe(true);
    expect(w.routers[0]?.close).not.toHaveBeenCalled();

    registry.releaseJoin(held);
    expect(registry.getRoom('room')).toBeUndefined();
    expect(w.routers[0]?.close).toHaveBeenCalled();
  });

  it('closes the router once the last peer leaves', async () => {
    const w = fakeWorker();
    const registry = new ConferenceRoomRegistry(w.worker);
    const room = await registry.getOrCreateRoom('room');
    registry.addPeer(room, 's1', participant);

    registry.removePeer(room, 's1');

    expect(w.routers[0]?.close).toHaveBeenCalled();
    expect(registry.getRoom('room')).toBeUndefined();
  });
});
