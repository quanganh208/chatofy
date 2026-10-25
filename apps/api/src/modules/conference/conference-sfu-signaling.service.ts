import { Injectable, Logger } from '@nestjs/common';
import type {
  ConferenceIceServer,
  ConferenceMediaPublish,
  ConferenceMediaRenegotiate,
  ConferenceMediaSubscribeReply,
} from '@chatofy/types';
import {
  CloudflareRealtimeClient,
  CloudflareRealtimeError,
} from './cloudflare-realtime.client';
import type {
  ConferenceRoom,
  ParticipantSession,
} from './conference-room-registry.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import type { ConferenceErrorReply } from './conference-socket';
import { SfuSessionQueue, type SfuSessionHold } from './sfu-session-queue';
import { missingTracks, pullWithRetry } from './conference-sfu-pull';
import { iceServersFrom } from './conference-sfu-ice-servers';
import { TokenBucket } from './conference-token-bucket';

/** How long a subscribe offer may wait for the client's answer. */
const ANSWER_TIMEOUT_MS = 10_000;
/** Cloudflare's cap on tracks in one `tracks/new` request. */
const MAX_TRACKS_PER_REQUEST = 64;
/** Long enough to outlast any meeting; Cloudflare allows up to 48 h. */
const TURN_CREDENTIAL_TTL_S = 43_200;
/**
 * TURN credentials are not per user, so one set serves every join on this
 * instance for half their lifetime, keeping the Cloudflare call off the join.
 */
const ICE_SERVERS_CACHE_MS = 6 * 60 * 60 * 1000;
/** Told to a client whose subscribe skipped something it may get on a later try. */
const SUBSCRIBE_RETRY_AFTER_MS = 1000;
/** A burst of this many `conference.media.*` requests per peer… */
const MEDIA_BURST = 20;
/** …refilling at this many per {@link MEDIA_REFILL_WINDOW_MS}. */
const MEDIA_REFILL_WINDOW_MS = 10_000;
/**
 * Close code for a client whose receiving session can no longer take a pull:
 * stuck on an unanswered SFU offer (no answer in time, the answer was
 * refused, or a pull whose outcome is unknown) or closed by the SFU. Not
 * 4000/4001, so the client reconnects and rebuilds both connections from
 * scratch.
 */
const CLOSE_MEDIA_RESTART = 1011;
/**
 * Pull failures that leave the receiving session unusable: a request that may
 * have been applied without its reply (status 0) can have left an offer on
 * it, 406 means one is there, and 410 means the SFU closed the session.
 */
const BROKEN_SESSION_STATUSES = new Set([0, 406, 410]);

/** The caller's seat, as the gateway resolved it from the socket. */
export interface SfuSeat {
  room: ConferenceRoom;
  peer: ParticipantSession;
  socketId: string;
}

interface OpenAnswer {
  roomId: string;
  peer: ParticipantSession;
  hold: SfuSessionHold;
}

// One publish and one subscribe session per socket, each created once and
// never reused by another socket, so a key per socket and direction names
// exactly one SFU session — and stays the same before and after it exists.
const pubKey = (socketId: string) => `pub:${socketId}`;
const subKey = (socketId: string) => `sub:${socketId}`;

/**
 * Meeting media on Cloudflare Realtime SFU, driven on each client's behalf.
 *
 * A client publishes its own tracks on one SFU session and receives everyone
 * else's on another. Every Cloudflare call on a session runs through that
 * session's queue, and a subscribe offer keeps its session locked until the
 * client's answer is in, because the SFU refuses a mutation on a session with
 * an unanswered offer.
 *
 * Nothing here logs SDP or a credential; failures are logged by Cloudflare
 * status and error code only.
 */
@Injectable()
export class ConferenceSfuSignaling {
  private readonly logger = new Logger(ConferenceSfuSignaling.name);
  private readonly queue = new SfuSessionQueue((key) =>
    this.answerTimedOut(key),
  );
  /** Subscribe offers awaiting the client's answer, by socket id. */
  private readonly openAnswers = new Map<string, OpenAnswer>();
  /** The last ICE servers with TURN credentials, shared by every join. */
  private iceServersCache?: {
    servers: ConferenceIceServer[];
    expiresAt: number;
  };

  constructor(
    private readonly cloudflare: CloudflareRealtimeClient,
    private readonly sockets: ConferenceSocketRegistry,
  ) {}

  /**
   * Cloudflare STUN, plus TURN credentials when a TURN key is set. A fetched
   * set is reused for {@link ICE_SERVERS_CACHE_MS}; a failed fetch is not
   * cached, so the next join tries again.
   */
  async iceServersFor(): Promise<ConferenceIceServer[]> {
    const cached = this.iceServersCache;
    if (cached && Date.now() < cached.expiresAt) return cached.servers;
    try {
      const turn = await this.cloudflare.generateIceServers(
        TURN_CREDENTIAL_TTL_S,
      );
      const servers = iceServersFrom(turn);
      this.iceServersCache = {
        servers,
        expiresAt: Date.now() + ICE_SERVERS_CACHE_MS,
      };
      return servers;
    } catch (err) {
      this.logger.warn(
        `TURN credentials unavailable, STUN only: ${describe(err)}`,
      );
      return iceServersFrom(null);
    }
  }

  publish(
    seat: SfuSeat,
    input: ConferenceMediaPublish,
  ): Promise<{ sdp: string } | ConferenceErrorReply> {
    const { room, peer, socketId } = seat;
    if (!takeMediaToken(peer))
      return Promise.resolve({ error: 'limit_reached' });
    return this.queue.run(pubKey(socketId), async () => {
      if (!isSeated(seat)) return { error: 'not_in_room' };
      if (peer.publishedTracks.length > 0) return { error: 'limit_reached' };
      try {
        // Kept on the peer before the push, so a failed publish's retry reuses
        // the session instead of leaving one behind per attempt.
        peer.pubSessionId ??= await this.cloudflare.newSession();
        const sessionId = peer.pubSessionId;
        const result = await this.cloudflare.pushTracks(
          sessionId,
          input.sdp,
          input.tracks.map(({ mid, kind }) => ({ mid, trackName: kind })),
        );
        const accepted = input.tracks.filter(({ mid, kind }) =>
          result.tracks.some(
            (t) => (t.trackName === kind || t.mid === mid) && !t.errorCode,
          ),
        );
        if (accepted.length < input.tracks.length) {
          // A partial publish would leave this peer silent or blank to the
          // room with nothing to retry it: undo it and fail the publish,
          // which the client treats as a failed attempt and reconnects.
          const codes = result.tracks.map((t) => t.errorCode ?? 'ok').join(',');
          this.logger.warn(`publish refused for ${socketId}: ${codes}`);
          await closeTracks(
            this.cloudflare,
            sessionId,
            accepted.map(({ mid }) => mid),
          ).catch((err: unknown) => {
            this.logger.warn(
              `close partly published tracks failed for ${socketId}: ${describe(err)}`,
            );
          });
          return { error: 'sfu_unavailable' };
        }
        // Stored even when the peer left meanwhile: its cleanup is queued
        // behind this call and closes whatever it finds here.
        peer.publishedTracks = accepted.map(({ mid, kind }) => ({
          mid,
          kind,
          trackName: kind,
        }));
        if (!isSeated(seat)) return { error: 'not_in_room' };
        this.sockets.sendToRoom(room, socketId, 'conference.media.published', {
          socketId,
        });
        return { sdp: result.answerSdp };
      } catch (err) {
        this.logger.warn(`publish failed for ${socketId}: ${describe(err)}`);
        return { error: 'sfu_unavailable' };
      }
    });
  }

  /** Bring the caller's receiving session up to date with the room. */
  subscribe(
    seat: SfuSeat,
  ): Promise<ConferenceMediaSubscribeReply | ConferenceErrorReply> {
    const { room, peer, socketId } = seat;
    if (!takeMediaToken(peer))
      return Promise.resolve({ error: 'limit_reached' });
    return this.queue.run(subKey(socketId), async () => {
      if (!isSeated(seat)) return { error: 'not_in_room' };
      // Set only once the session exists: a failed `sessions/new` leaves
      // nothing behind, so a later subscribe can simply try again.
      let pulling = false;
      try {
        peer.subSessionId ??= await this.cloudflare.newSession();
        pulling = true;
        const wanted = missingTracks(room, socketId, peer).slice(
          0,
          MAX_TRACKS_PER_REQUEST,
        );
        if (wanted.length === 0) return { sdp: null, mids: [] };
        const result = await pullWithRetry(
          this.cloudflare,
          peer.subSessionId,
          wanted,
          (skipped) =>
            this.logger.warn(`pull skipped for ${socketId}: ${skipped}`),
        );
        for (const { mid, from } of result.pulled) {
          peer.pulled.set(mid, { socketId: from.socketId, kind: from.kind });
        }
        // A peer that left meanwhile gets no hold: its cleanup is queued on
        // this key and would otherwise wait out the answer timeout.
        if (!isSeated(seat)) return { error: 'not_in_room' };
        if (result.offerSdp !== null) {
          const hold = this.queue.hold(subKey(socketId), ANSWER_TIMEOUT_MS);
          this.openAnswers.set(socketId, { roomId: room.id, peer, hold });
        }
        return {
          sdp: result.offerSdp,
          mids: result.pulled.map(({ mid, from }) => ({
            mid,
            socketId: from.socketId,
            kind: from.kind,
          })),
          ...(result.retryable
            ? { retryAfterMs: SUBSCRIBE_RETRY_AFTER_MS }
            : {}),
        };
      } catch (err) {
        this.logger.warn(`subscribe failed for ${socketId}: ${describe(err)}`);
        if (!isSeated(seat)) return { error: 'not_in_room' };
        if (
          pulling &&
          err instanceof CloudflareRealtimeError &&
          BROKEN_SESSION_STATUSES.has(err.status)
        ) {
          // Every later pull on this session would fail the same way.
          this.sockets
            .get(socketId)
            ?.close(CLOSE_MEDIA_RESTART, 'subscribe session broken');
          return { error: 'sfu_unavailable' };
        }
        // Nothing was left on the session: the client asks again later.
        return { sdp: null, mids: [], retryAfterMs: SUBSCRIBE_RETRY_AFTER_MS };
      }
    });
  }

  /** Submit the client's answer to its last subscribe offer, then unlock the session. */
  async renegotiate(
    seat: SfuSeat,
    input: ConferenceMediaRenegotiate,
  ): Promise<{ ok: true } | ConferenceErrorReply> {
    const { peer, socketId } = seat;
    if (!takeMediaToken(peer)) return { error: 'limit_reached' };
    const open = this.openAnswers.get(socketId);
    if (!open || open.peer !== peer || !peer.subSessionId) {
      return { error: 'invalid_payload' };
    }
    // Taken out before the await, so a repeated answer is refused rather
    // than submitted twice.
    this.openAnswers.delete(socketId);
    // The answer is in: a slow Cloudflare call must not lose the lock to the
    // answer timeout and let the next mutation overlap it.
    open.hold.disarm();
    try {
      await this.cloudflare.renegotiate(peer.subSessionId, input.sdp);
      return { ok: true };
    } catch (err) {
      this.logger.warn(`renegotiate failed for ${socketId}: ${describe(err)}`);
      // The SFU still holds an unanswered offer on this session, so every
      // later pull would be refused. Rebuild from scratch instead.
      this.sockets
        .get(socketId)
        ?.close(CLOSE_MEDIA_RESTART, 'subscribe answer refused');
      return { error: 'sfu_unavailable' };
    } finally {
      open.hold.release();
    }
  }

  /**
   * A peer left, was replaced or disconnected: stop what it published and
   * what it received, and stop every other peer receiving it. Fire-and-forget;
   * failures are logged and never thrown.
   */
  cleanupPeer(
    room: ConferenceRoom,
    socketId: string,
    peer: ParticipantSession,
  ): void {
    this.closeOwnSessions(socketId, peer);
    for (const [otherId, other] of room.peers) {
      if (otherId === socketId) continue;
      this.background(
        subKey(otherId),
        'close tracks pulled from a leaver',
        () => {
          const mids = [...other.pulled]
            .filter(([, from]) => from.socketId === socketId)
            .map(([mid]) => mid);
          mids.forEach((mid) => other.pulled.delete(mid));
          return closeTracks(this.cloudflare, other.subSessionId, mids);
        },
      );
    }
  }

  /** The room ended: close every peer's sessions. Fire-and-forget. */
  cleanupRoom(room: ConferenceRoom): void {
    for (const [socketId, peer] of [...room.peers]) {
      this.closeOwnSessions(socketId, peer);
    }
  }

  private closeOwnSessions(socketId: string, peer: ParticipantSession): void {
    const open = this.openAnswers.get(socketId);
    if (open?.peer === peer) {
      this.openAnswers.delete(socketId);
      open.hold.release();
    }
    // Queued, so a publish or subscribe still in flight lands first and the
    // tracks it adds are closed too.
    this.background(pubKey(socketId), 'close published tracks', () =>
      closeTracks(
        this.cloudflare,
        peer.pubSessionId,
        peer.publishedTracks.map((t) => t.mid),
      ),
    );
    this.background(subKey(socketId), 'close received tracks', () =>
      closeTracks(this.cloudflare, peer.subSessionId, [...peer.pulled.keys()]),
    );
  }

  /** Run `fn` on the session queue for `key`; log a failure, never throw it. */
  private background(key: string, what: string, fn: () => Promise<void>): void {
    this.queue.run(key, fn).catch((err: unknown) => {
      this.logger.warn(`${what} failed (${key}): ${describe(err)}`);
    });
  }

  /** The client never answered: free the session and make it start over. */
  private answerTimedOut(key: string): void {
    const socketId = key.slice(subKey('').length);
    const open = this.openAnswers.get(socketId);
    if (!open) return;
    this.openAnswers.delete(socketId);
    this.logger.warn(
      `subscribe answer timed out: room ${open.roomId} socket ${socketId}`,
    );
    this.sockets
      .get(socketId)
      ?.close(CLOSE_MEDIA_RESTART, 'subscribe answer timed out');
  }
}

/**
 * Spend one of the peer's media tokens. Taken before a request is queued, so
 * a socket cannot pile up requests that each cost Cloudflare calls.
 */
function takeMediaToken(peer: ParticipantSession): boolean {
  peer.limits.media ??= new TokenBucket(
    MEDIA_BURST,
    MEDIA_BURST / (MEDIA_REFILL_WINDOW_MS / 1000),
  );
  return peer.limits.media.take();
}

/** Whether the seat is still its socket's live session after an await. */
function isSeated({ room, peer, socketId }: SfuSeat): boolean {
  return room.peers.get(socketId) === peer;
}

function closeTracks(
  cloudflare: CloudflareRealtimeClient,
  sessionId: string | undefined,
  mids: string[],
): Promise<void> {
  if (!sessionId) return Promise.resolve();
  // 410 means the SFU already closed the session — the client's connection
  // went first, which is the normal way a call ends — so there is nothing
  // left to close. 406 means the session still holds an offer nobody will
  // answer: it is being abandoned, and the SFU closes it once the client's
  // connection goes.
  return cloudflare.forceCloseTracks(sessionId, mids).catch((err: unknown) => {
    if (
      err instanceof CloudflareRealtimeError &&
      (err.status === 410 || err.status === 406)
    ) {
      return;
    }
    throw err;
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
