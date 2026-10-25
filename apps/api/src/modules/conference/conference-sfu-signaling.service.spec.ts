import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  CloudflareRealtimeError,
  type CloudflareRealtimeClient,
} from './cloudflare-realtime.client';
import type {
  ConferenceRoom,
  ParticipantSession,
} from './conference-room-registry.service';
import { ConferenceSfuSignaling } from './conference-sfu-signaling.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { SOCKET_OPEN, type ConferenceSocket } from './conference-socket';

/**
 * The SFU signaling against a Cloudflare client double. Rooms and peers are
 * plain objects in the registry's shape; sockets go through the real socket
 * registry so broadcasts and closes are observed where clients would see them.
 */

function fakeCloudflare() {
  let session = 0;
  return {
    newSession: vi.fn(() => Promise.resolve(`sess-${++session}`)),
    pushTracks: vi.fn(
      (
        _id: string,
        _sdp: string,
        tracks: { mid: string; trackName: string }[],
      ) => Promise.resolve({ answerSdp: 'v=0 answer', tracks }),
    ),
    pullTracks: vi.fn(
      (_id: string, remotes: { sessionId: string; trackName: string }[]) =>
        Promise.resolve({
          offerSdp: 'v=0 sfu offer',
          requiresImmediateRenegotiation: true,
          tracks: remotes.map((r, i) => ({ ...r, mid: `m${i}` })),
        }),
    ),
    renegotiate: vi.fn(() => Promise.resolve()),
    forceCloseTracks: vi.fn(() => Promise.resolve()),
    generateIceServers: vi.fn(() => Promise.resolve(null)),
  };
}

type CloseMock = Mock<(code?: number, reason?: string) => void>;
type FakeSocket = ConferenceSocket & {
  frames: { event: string; data: unknown }[];
  closeMock: CloseMock;
};

function harness() {
  const cloudflare = fakeCloudflare();
  const sockets = new ConferenceSocketRegistry();
  const sfu = new ConferenceSfuSignaling(
    cloudflare as unknown as CloudflareRealtimeClient,
    sockets,
  );
  const room: ConferenceRoom = { id: 'room-1', peers: new Map(), joining: 0 };
  const byId = new Map<string, FakeSocket>();

  const seat = (socketId: string) => {
    const peer: ParticipantSession = {
      userId: `user-${socketId}`,
      displayName: socketId,
      sourceLanguage: 'vi',
      participantId: `p-${socketId}`,
      muted: false,
      videoEnabled: true,
      publishedTracks: [],
      pulled: new Map(),
      persistedTurnIds: new Set(),
      limits: {},
    };
    room.peers.set(socketId, peer);
    const close: CloseMock = vi.fn();
    const ws: FakeSocket = {
      frames: [],
      readyState: SOCKET_OPEN,
      send(data: string) {
        this.frames.push(JSON.parse(data) as { event: string; data: unknown });
      },
      closeMock: close,
      close,
      terminate: vi.fn(),
      _socketId: socketId,
    };
    sockets.add(ws);
    byId.set(socketId, ws);
    return { room, peer, socketId };
  };

  const publishBody = {
    sdp: 'v=0 offer',
    tracks: [
      { mid: '0', kind: 'audio' as const },
      { mid: '1', kind: 'video' as const },
    ],
  };

  return {
    cloudflare,
    sfu,
    room,
    seat,
    socket: (id: string) => byId.get(id),
    publishBody,
  };
}

/** Let fire-and-forget work queued on the session queues settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConferenceSfuSignaling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the published tracks and tells only the other peers', async () => {
    const h = harness();
    const alice = h.seat('alice');
    h.seat('bob');

    const reply = await h.sfu.publish(alice, h.publishBody);

    expect(reply).toStrictEqual({ sdp: 'v=0 answer' });
    expect(alice.peer.pubSessionId).toBe('sess-1');
    expect(alice.peer.publishedTracks).toStrictEqual([
      { mid: '0', kind: 'audio', trackName: 'audio' },
      { mid: '1', kind: 'video', trackName: 'video' },
    ]);
    expect(h.socket('bob')?.frames).toStrictEqual([
      { event: 'conference.media.published', data: { socketId: 'alice' } },
    ]);
    expect(h.socket('alice')?.frames).toStrictEqual([]);
  });

  it('refuses a second publish with limit_reached', async () => {
    const h = harness();
    const alice = h.seat('alice');

    await h.sfu.publish(alice, h.publishBody);
    const second = await h.sfu.publish(alice, h.publishBody);

    expect(second).toStrictEqual({ error: 'limit_reached' });
    expect(h.cloudflare.pushTracks).toHaveBeenCalledTimes(1);
  });

  it('creates the receiving session on the first subscribe and pulls every other publisher', async () => {
    const h = harness();
    const [alice, bob, carol] = ['alice', 'bob', 'carol'].map((id) =>
      h.seat(id),
    );
    await h.sfu.publish(alice!, h.publishBody);
    await h.sfu.publish(bob!, h.publishBody);

    const reply = await h.sfu.subscribe(carol!);

    expect(carol!.peer.subSessionId).toBe('sess-3');
    expect(h.cloudflare.pullTracks).toHaveBeenCalledWith('sess-3', [
      { sessionId: 'sess-1', trackName: 'audio' },
      { sessionId: 'sess-1', trackName: 'video' },
      { sessionId: 'sess-2', trackName: 'audio' },
      { sessionId: 'sess-2', trackName: 'video' },
    ]);
    expect(reply).toStrictEqual({
      sdp: 'v=0 sfu offer',
      mids: [
        { mid: 'm0', socketId: 'alice', kind: 'audio' },
        { mid: 'm1', socketId: 'alice', kind: 'video' },
        { mid: 'm2', socketId: 'bob', kind: 'audio' },
        { mid: 'm3', socketId: 'bob', kind: 'video' },
      ],
    });
  });

  it('answers a subscribe with nothing new without calling Cloudflare', async () => {
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    await h.sfu.publish(alice, h.publishBody);
    await h.sfu.subscribe(bob);
    await h.sfu.renegotiate(bob, { sdp: 'v=0 answer' });
    h.cloudflare.pullTracks.mockClear();

    const reply = await h.sfu.subscribe(bob);

    expect(reply).toStrictEqual({ sdp: null, mids: [] });
    expect(h.cloudflare.pullTracks).toHaveBeenCalledTimes(0);
  });

  it('holds the receiving session until the answer is in, then runs the next subscribe', async () => {
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    const carol = h.seat('carol');
    await h.sfu.publish(alice, h.publishBody);
    await h.sfu.subscribe(carol);
    const log: string[] = [];
    h.cloudflare.renegotiate.mockImplementation(() => {
      log.push('renegotiate');
      return Promise.resolve();
    });

    await h.sfu.publish(bob, h.publishBody);
    const during = h.sfu.subscribe(carol).then((reply) => {
      log.push('subscribe');
      return reply;
    });
    await settle();
    expect(log).toStrictEqual([]);

    expect(await h.sfu.renegotiate(carol, { sdp: 'v=0 answer' })).toStrictEqual(
      { ok: true },
    );
    expect(await during).toMatchObject({
      mids: [
        { socketId: 'bob', kind: 'audio' },
        { socketId: 'bob', kind: 'video' },
      ],
    });
    expect(log).toStrictEqual(['renegotiate', 'subscribe']);
    expect(await h.sfu.renegotiate(carol, { sdp: 'v=0 answer' })).toStrictEqual(
      { ok: true },
    );
    expect(await h.sfu.renegotiate(carol, { sdp: 'v=0 answer' })).toStrictEqual(
      {
        error: 'invalid_payload',
      },
    );
  });

  it('closes the socket with 1011 when the answer never comes', async () => {
    vi.useFakeTimers();
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    await h.sfu.publish(alice, h.publishBody);
    await h.sfu.subscribe(bob);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.socket('bob')?.closeMock).toHaveBeenCalledWith(
      1011,
      'subscribe answer timed out',
    );
    expect(await h.sfu.renegotiate(bob, { sdp: 'v=0 late' })).toStrictEqual({
      error: 'invalid_payload',
    });
  });

  it('keeps the lock through a slow renegotiate instead of timing it out', async () => {
    vi.useFakeTimers();
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    await h.sfu.publish(alice, h.publishBody);
    await h.sfu.subscribe(bob);
    let finish: () => void = () => undefined;
    h.cloudflare.renegotiate.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    const answered = h.sfu.renegotiate(bob, { sdp: 'v=0 answer' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.socket('bob')?.closeMock).not.toHaveBeenCalled();
    finish();
    expect(await answered).toStrictEqual({ ok: true });
  });

  it('closes the socket with 1011 when Cloudflare refuses the answer', async () => {
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    await h.sfu.publish(alice, h.publishBody);
    await h.sfu.subscribe(bob);
    h.cloudflare.renegotiate.mockRejectedValueOnce(new Error('boom'));

    expect(await h.sfu.renegotiate(bob, { sdp: 'v=0 answer' })).toStrictEqual({
      error: 'sfu_unavailable',
    });
    expect(h.socket('bob')?.closeMock).toHaveBeenCalledWith(
      1011,
      'subscribe answer refused',
    );
  });

  it('treats a session the SFU already closed as cleaned up', async () => {
    const h = harness();
    const alice = h.seat('alice');
    await h.sfu.publish(alice, h.publishBody);
    h.cloudflare.forceCloseTracks.mockRejectedValue(
      new CloudflareRealtimeError(410, 'session_error'),
    );
    const warn = vi.spyOn(Logger.prototype, 'warn');

    h.sfu.cleanupPeer(alice.room, alice.socketId, alice.peer);
    await vi.waitFor(() =>
      expect(h.cloudflare.forceCloseTracks).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('failed'));
  });

  it('closes a leaver’s own tracks, and only the tracks other peers pulled from it', async () => {
    const h = harness();
    const [alice, bob, carol] = ['alice', 'bob', 'carol'].map((id) =>
      h.seat(id),
    );
    await h.sfu.publish(alice!, h.publishBody);
    await h.sfu.publish(bob!, h.publishBody);
    await h.sfu.subscribe(alice!);
    await h.sfu.renegotiate(alice!, { sdp: 'v=0 answer' });
    await h.sfu.subscribe(carol!);
    await h.sfu.renegotiate(carol!, { sdp: 'v=0 answer' });

    h.room.peers.delete('alice');
    h.sfu.cleanupPeer(h.room, 'alice', alice!.peer);
    await settle();

    const closes = h.cloudflare.forceCloseTracks.mock.calls as unknown as [
      string,
      string[],
    ][];
    expect(closes).toContainEqual([alice!.peer.pubSessionId, ['0', '1']]);
    expect(closes).toContainEqual([alice!.peer.subSessionId, ['m0', 'm1']]);
    // Carol pulled alice on m0/m1 and bob on m2/m3; only alice's go.
    expect(closes).toContainEqual([carol!.peer.subSessionId, ['m0', 'm1']]);
    expect([...carol!.peer.pulled.values()]).toStrictEqual([
      { socketId: 'bob', kind: 'audio' },
      { socketId: 'bob', kind: 'video' },
    ]);
    // Bob published but never subscribed: there is nothing of his to close.
    expect(closes.filter(([id]) => id === bob!.peer.subSessionId)).toHaveLength(
      0,
    );
  });

  it('retries a pull once when a track fails with a retryable error', async () => {
    vi.useFakeTimers();
    const h = harness();
    const alice = h.seat('alice');
    const bob = h.seat('bob');
    await h.sfu.publish(alice, {
      sdp: 'v=0 offer',
      tracks: [{ mid: '0', kind: 'video' }],
    });
    h.cloudflare.pullTracks.mockResolvedValueOnce({
      offerSdp: null,
      requiresImmediateRenegotiation: false,
      tracks: [
        {
          sessionId: 'sess-1',
          trackName: 'video',
          mid: '',
          errorCode: 'retryable_transient_error',
        },
      ],
    } as never);

    const pending = h.sfu.subscribe(bob);
    await vi.advanceTimersByTimeAsync(500);
    const reply = await pending;

    expect(h.cloudflare.pullTracks).toHaveBeenCalledTimes(2);
    expect(reply).toStrictEqual({
      sdp: 'v=0 sfu offer',
      mids: [{ mid: 'm0', socketId: 'alice', kind: 'video' }],
    });
  });

  it('replies sfu_unavailable when Cloudflare refuses the call', async () => {
    const h = harness();
    const alice = h.seat('alice');
    h.cloudflare.newSession.mockRejectedValueOnce(
      new CloudflareRealtimeError(503, 'backend_error'),
    );

    expect(await h.sfu.publish(alice, h.publishBody)).toStrictEqual({
      error: 'sfu_unavailable',
    });
    expect(alice.peer.publishedTracks).toStrictEqual([]);
  });

  it('offers Cloudflare STUN alone without TURN, and drops port-53 TURN URLs', async () => {
    const h = harness();
    expect(await h.sfu.iceServersFor()).toStrictEqual([
      { urls: 'stun:stun.cloudflare.com:3478' },
    ]);

    h.cloudflare.generateIceServers.mockResolvedValueOnce([
      {
        urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'],
      },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'u',
        credential: 'c',
      },
    ] as never);

    expect(await h.sfu.iceServersFor()).toStrictEqual([
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'u',
        credential: 'c',
      },
    ]);
  });

  it('falls back to STUN when the TURN credential call fails', async () => {
    const h = harness();
    h.cloudflare.generateIceServers.mockRejectedValueOnce(
      new CloudflareRealtimeError(500, 'internal_error'),
    );

    expect(await h.sfu.iceServersFor()).toStrictEqual([
      { urls: 'stun:stun.cloudflare.com:3478' },
    ]);
  });
});
