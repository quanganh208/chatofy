import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFERENCE_CLOSE_ENDED,
  CONFERENCE_CLOSE_REPLACED,
  MAX_CONFERENCE_AUDIO_PAYLOAD_CHARS,
} from '@chatofy/types';
import { InMemoryConferencePrisma } from '../../../test/utils/in-memory-conference-prisma';
import type { AuthAdapter } from '../auth/interfaces/auth-adapter.interface';
import { SessionTerminator } from '../auth/session-terminator';
import type { PipelineTranslatorService } from '../translate/services/pipeline-translator.service';
import { VERIFIED_USER_ID } from '../translate/ws-auth';
import type { Env } from '../../config/env.schema';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceMediaSignaling } from './conference-media-signaling.service';
import { ConferencePeerLifecycle } from './conference-peer-lifecycle.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceService } from './conference.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { SOCKET_OPEN, type ConferenceSocket } from './conference-socket';
import { ConferenceWebRtcTransportFactory } from './conference-webrtc-transport.factory';
import type { ConferenceWorkerService } from './conference-worker.service';
import { CHAT_BURST, ConferenceChat } from './services/conference-chat.service';
import { RELAY_CHAR_BURST } from './services/conference-translation-relay.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';
import { ConferenceTranslationRelay } from './services/conference-translation-relay.service';
import { ConferenceTranslationRouter } from './services/conference-translation-router.service';

/**
 * The gateway and every service behind it run for real; only the two edges
 * are doubles — mediasoup (a router whose transports are plain objects) and
 * Prisma (the in-memory conference store, which keeps Postgres's unique key,
 * foreign key and visibility rules).
 */

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

class FakeSocket implements ConferenceSocket {
  readyState = SOCKET_OPEN;
  readonly frames: Frame[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  _userId?: string;
  _socketId?: string;
  _roomId?: string;
  _joining?: boolean;
  _isAlive?: boolean;

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Frame);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  on(): void {}

  last(event: string): Record<string, unknown> | undefined {
    return this.frames.filter((f) => f.event === event).at(-1)?.data;
  }
  all(event: string): Record<string, unknown>[] {
    return this.frames.filter((f) => f.event === event).map((f) => f.data);
  }
}

let transportSeq = 0;
function fakeTransport() {
  transportSeq += 1;
  return {
    id: `t${transportSeq}`,
    iceParameters: {},
    iceCandidates: [],
    dtlsParameters: {},
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    produce: vi.fn(async ({ kind }: { kind: string }) => {
      // Resolves on a later tick, like a real worker round trip, so calls
      // pipelined by one client overlap.
      await new Promise((resolve) => setTimeout(resolve, 0));
      transportSeq += 1;
      return {
        id: `p${transportSeq}`,
        kind,
        appData: {},
        on: vi.fn(),
        close: vi.fn(),
      };
    }),
  };
}

function fakeRouter() {
  return {
    rtpCapabilities: { codecs: [] },
    close: vi.fn(),
    canConsume: () => true,
    createWebRtcTransport: vi.fn(() => Promise.resolve(fakeTransport())),
  };
}

function buildHarness() {
  const prisma = new InMemoryConferencePrisma();
  let workerDied: () => void = () => undefined;
  const worker = {
    onWorkerDied: (listener: () => void) => {
      workerDied = listener;
    },
    getWorker: () => ({ createRouter: () => Promise.resolve(fakeRouter()) }),
  } as unknown as ConferenceWorkerService;
  const config = {
    get: (key: keyof Env) =>
      (({ MEDIASOUP_ANNOUNCED_IP: '127.0.0.1' }) as Partial<Env>)[key],
  } as unknown as ConfigService<Env, true>;
  const translator = {
    translateAll: ({ text, targets }: { text: string; targets: string[] }) =>
      Promise.resolve(
        Object.fromEntries(targets.map((t) => [t, `[${t}] ${text}`])),
      ),
  } as unknown as PipelineTranslatorService;
  const auth = {
    verifyToken: vi.fn().mockResolvedValue({ sub: 'unused' }),
  } as unknown as AuthAdapter;

  const rooms = new ConferenceRoomRegistry(worker);
  const sockets = new ConferenceSocketRegistry();
  const conferences = new ConferenceService(prisma.asPrismaService(), rooms);
  const persistence = new ConferencePersistenceService(
    prisma.asPrismaService(),
  );
  const lifecycle = new ConferencePeerLifecycle(
    rooms,
    sockets,
    conferences,
    persistence,
  );
  const transports = new ConferenceWebRtcTransportFactory(config);
  const media = new ConferenceMediaSignaling(lifecycle, sockets, transports);
  const relay = new ConferenceTranslationRelay(
    lifecycle,
    sockets,
    new ConferenceTranslationRouter(),
    persistence,
  );
  const chat = new ConferenceChat(lifecycle, sockets, translator, persistence);
  const terminator = new SessionTerminator();
  const gateway = new ConferenceGateway(
    sockets,
    lifecycle,
    media,
    relay,
    chat,
    auth,
    terminator,
  );

  const connect = (userId: string): FakeSocket => {
    const ws = new FakeSocket();
    gateway.handleConnection(ws, { headers: {}, [VERIFIED_USER_ID]: userId });
    return ws;
  };

  const join = async (
    ws: FakeSocket,
    roomId: string,
    displayName: string,
    sourceLanguage: string,
  ) => {
    await gateway.handleJoin(ws, { roomId, displayName, sourceLanguage });
    return ws.last('conference.join');
  };

  return {
    killWorker: () => workerDied(),
    prisma,
    rooms,
    conferences,
    gateway,
    terminator,
    connect,
    join,
  };
}

/** Let fire-and-forget persistence settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConferenceGateway', () => {
  let h: ReturnType<typeof buildHarness>;
  let roomId: string;

  beforeEach(() => {
    h = buildHarness();
    roomId = h.prisma.seed({ ownerId: 'alice' }).id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('join', () => {
    it('refuses a payload that does not match the contract', async () => {
      const ws = h.connect('alice');

      await h.gateway.handleJoin(ws, {
        roomId: 'not a cuid',
        displayName: 'A',
      });

      expect(ws.last('conference.join')).toStrictEqual({
        error: 'invalid_payload',
      });
      expect(h.rooms.getAllRooms()).toHaveLength(0);
    });

    it('refuses a room id that POST /conference never minted, and creates nothing', async () => {
      const ws = h.connect('alice');

      const reply = await h.join(ws, 'cneverminted0000', 'Alice', 'vi');

      expect(reply).toStrictEqual({ error: 'room_not_found' });
      expect(h.prisma.conferences.size).toBe(1);
      expect(h.prisma.participants).toHaveLength(0);
    });

    it('refuses a room that has ended', async () => {
      const ended = h.prisma.seed({ ownerId: 'alice', status: 'ended' });
      const ws = h.connect('bob');

      expect(await h.join(ws, ended.id, 'Bob', 'en')).toStrictEqual({
        error: 'room_ended',
      });
    });

    it('admits anyone holding the id, records the participant, and activates the room', async () => {
      const ws = h.connect('bob');

      const reply = await h.join(ws, roomId, 'Bob', 'en');

      expect(reply).toMatchObject({ socketId: ws._socketId, peers: [] });
      expect(ws._roomId).toBe(roomId);
      expect(h.prisma.participants).toMatchObject([
        { conferenceId: roomId, userId: 'bob', status: 'joined' },
      ]);
      await flush();
      const row = h.prisma.conferences.get(roomId);
      expect(row?.status).toBe('active');
      expect(row?.startedAt).toBeInstanceOf(Date);
      // The gateway never makes the joiner an owner.
      expect(row?.ownerId).toBe('alice');
    });

    it('closes the older socket with 4000 when the same user joins again', async () => {
      const first = h.connect('bob');
      const other = h.connect('carol');
      await h.join(first, roomId, 'Bob', 'en');
      await h.join(other, roomId, 'Carol', 'vi');

      const second = h.connect('bob');
      await h.join(second, roomId, 'Bob', 'en');

      expect(first.closedWith).toStrictEqual({
        code: CONFERENCE_CLOSE_REPLACED,
        reason: 'replaced',
      });
      expect(first._roomId).toBeUndefined();
      expect(other.all('conference.peer.left')).toContainEqual({
        socketId: first._socketId,
      });
      const room = h.rooms.getRoom(roomId);
      expect([...(room?.peers.keys() ?? [])].sort()).toStrictEqual(
        [other._socketId, second._socketId].sort(),
      );

      // The evicted socket's close event records no leave for a user still in.
      h.gateway.handleDisconnect(first);
      await flush();
      expect(
        h.prisma.participants.find((p) => p.userId === 'bob')?.status,
      ).toBe('joined');
    });
  });

  describe('rejoin while alone', () => {
    it('keeps the live room when the only peer is the same user rejoining', async () => {
      const first = h.connect('bob');
      await h.join(first, roomId, 'Bob', 'en');
      const room = h.rooms.getRoom(roomId);
      const router = room?.router as unknown as {
        close: ReturnType<typeof vi.fn>;
      };

      const second = h.connect('bob');
      const reply = await h.join(second, roomId, 'Bob', 'en');

      expect(reply).toHaveProperty('socketId', second._socketId);
      expect(first.closedWith?.code).toBe(CONFERENCE_CLOSE_REPLACED);
      expect(h.rooms.getRoom(roomId)).toBe(room);
      expect(router.close).not.toHaveBeenCalled();
      expect([...(room?.peers.keys() ?? [])]).toStrictEqual([second._socketId]);

      await h.gateway.handleTransportCreate(second, { direction: 'send' });
      expect(second.last('conference.transport.create')).toHaveProperty('id');
    });

    it('opens the room again when it was torn down mid-join while still joinable', async () => {
      const ws = h.connect('bob');
      const status = h.conferences.joinableStatus.bind(h.conferences);
      let calls = 0;
      vi.spyOn(h.conferences, 'joinableStatus').mockImplementation(
        async (id) => {
          calls += 1;
          // The re-check after the room was opened: the media worker dies just
          // before it answers, dropping every room.
          if (calls === 2) h.killWorker();
          return status(id);
        },
      );

      const reply = await h.join(ws, roomId, 'Bob', 'en');

      expect(reply).toHaveProperty('socketId', ws._socketId);
      expect(h.rooms.getRoom(roomId)?.peers.has(ws._socketId ?? '')).toBe(true);
    });

    it('does not drop a room another join is holding when one join aborts', async () => {
      const aborting = h.connect('bob');
      const staying = h.connect('carol');
      const joins = [
        h.join(aborting, roomId, 'Bob', 'en'),
        h.join(staying, roomId, 'Carol', 'vi'),
      ];
      // Bob's socket closes while both joins are in flight.
      aborting.readyState = 3;
      await Promise.all(joins);

      expect(staying.last('conference.join')).toHaveProperty('socketId');
      const room = h.rooms.getRoom(roomId);
      expect([...(room?.peers.keys() ?? [])]).toStrictEqual([
        staying._socketId,
      ]);
      await h.gateway.handleTransportCreate(staying, { direction: 'recv' });
      expect(staying.last('conference.transport.create')).toHaveProperty('id');
    });
  });

  describe('produce', () => {
    const produceBody = (kind: 'audio' | 'video') => ({
      kind,
      rtpParameters: { codecs: [{ mimeType: 'audio/opus' }] },
    });

    it('counts produce calls still in flight against the per-peer cap', async () => {
      const ws = h.connect('bob');
      await h.join(ws, roomId, 'Bob', 'en');
      await h.gateway.handleTransportCreate(ws, { direction: 'send' });

      await Promise.all([
        h.gateway.handleProduce(ws, produceBody('audio')),
        h.gateway.handleProduce(ws, produceBody('video')),
        h.gateway.handleProduce(ws, produceBody('video')),
      ]);

      const replies = ws.all('conference.produce');
      expect(replies.filter((r) => 'id' in r)).toHaveLength(2);
      expect(replies).toContainEqual({ error: 'limit_reached' });
    });
  });

  describe('transport.create', () => {
    it('allows one transport per direction', async () => {
      const ws = h.connect('bob');
      await h.join(ws, roomId, 'Bob', 'en');

      await h.gateway.handleTransportCreate(ws, { direction: 'send' });
      expect(ws.last('conference.transport.create')).toHaveProperty('id');

      await h.gateway.handleTransportCreate(ws, { direction: 'send' });
      expect(ws.last('conference.transport.create')).toStrictEqual({
        error: 'transport_exists',
      });

      await h.gateway.handleTransportCreate(ws, { direction: 'sideways' });
      expect(ws.last('conference.transport.create')).toStrictEqual({
        error: 'invalid_payload',
      });
    });

    it('refuses a second create for a direction still being created', async () => {
      const ws = h.connect('bob');
      await h.join(ws, roomId, 'Bob', 'en');

      await Promise.all([
        h.gateway.handleTransportCreate(ws, { direction: 'recv' }),
        h.gateway.handleTransportCreate(ws, { direction: 'recv' }),
      ]);

      const replies = ws.all('conference.transport.create');
      expect(replies.filter((r) => 'id' in r)).toHaveLength(1);
      expect(replies).toContainEqual({ error: 'transport_exists' });
    });
  });

  describe('translation broadcast', () => {
    const turnId = '5b0c8f0e-7c1a-4a7e-9d0b-1f2e3d4c5b6a';

    it('delivers translated speech only to listeners of its language, under the real speaker id', async () => {
      const speaker = h.connect('alice');
      const viListener = h.connect('bob');
      const enListener = h.connect('carol');
      await h.join(speaker, roomId, 'Alice', 'vi');
      await h.join(viListener, roomId, 'Bob', 'vi');
      await h.join(enListener, roomId, 'Carol', 'en');

      h.gateway.handleTranslationBroadcast(speaker, {
        audio: {
          lang: 'en',
          sequence: 7,
          sampleRate: 24000,
          payload: 'AAAA',
          speakerSocketId: viListener._socketId,
        },
      });

      expect(viListener.all('conference.translation.audio')).toHaveLength(0);
      expect(speaker.all('conference.translation.audio')).toHaveLength(0);
      expect(enListener.all('conference.translation.audio')).toStrictEqual([
        {
          lang: 'en',
          sequence: 7,
          sampleRate: 24000,
          payload: 'AAAA',
          speakerSocketId: speaker._socketId,
        },
      ]);
    });

    it('stores a turn once, from its final frame, with the source text and the translation by language', async () => {
      const speaker = h.connect('alice');
      const listener = h.connect('carol');
      await h.join(speaker, roomId, 'Alice', 'vi');
      await h.join(listener, roomId, 'Carol', 'en');
      const frame = (
        isFinal: boolean,
        sourceText: string,
        translatedText: string,
      ) => ({
        subtitle: {
          sourceLanguage: 'vi',
          targetLanguage: 'en',
          sourceText,
          translatedText,
          isFinal,
          turnId,
        },
      });

      h.gateway.handleTranslationBroadcast(speaker, frame(false, 'xin', 'hel'));
      h.gateway.handleTranslationBroadcast(
        speaker,
        frame(true, 'xin chào', 'hello'),
      );
      h.gateway.handleTranslationBroadcast(
        speaker,
        frame(true, 'xin chào', 'hello'),
      );
      await flush();

      expect(listener.all('conference.translation.subtitle')).toHaveLength(3);
      expect(h.prisma.turns).toHaveLength(1);
      expect(h.prisma.turns[0]).toMatchObject({
        conferenceId: roomId,
        sourceLanguage: 'vi',
        sourceText: 'xin chào',
        translations: { en: 'hello' },
      });
    });

    it('refuses frames past the per-peer relay budget with limit_reached', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const speaker = h.connect('alice');
      const listener = h.connect('carol');
      await h.join(speaker, roomId, 'Alice', 'vi');
      await h.join(listener, roomId, 'Carol', 'en');
      const bigFrame = {
        audio: {
          lang: 'en',
          sequence: 0,
          sampleRate: 24000,
          payload: 'A'.repeat(MAX_CONFERENCE_AUDIO_PAYLOAD_CHARS),
        },
      };

      const allowed = Math.floor(
        RELAY_CHAR_BURST / MAX_CONFERENCE_AUDIO_PAYLOAD_CHARS,
      );
      for (let i = 0; i <= allowed; i += 1) {
        h.gateway.handleTranslationBroadcast(speaker, bigFrame);
      }

      expect(listener.all('conference.translation.audio')).toHaveLength(
        allowed,
      );
      expect(speaker.last('conference.translation.broadcast')).toStrictEqual({
        error: 'limit_reached',
      });

      // The budget refills: a second later the speaker is heard again.
      vi.setSystemTime(Date.now() + 1000);
      h.gateway.handleTranslationBroadcast(speaker, bigFrame);
      expect(listener.all('conference.translation.audio')).toHaveLength(
        allowed + 1,
      );
    });

    it('lets a real-time speaker through: 200 ms audio frames plus subtitle deltas for a minute', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const speaker = h.connect('alice');
      const listener = h.connect('carol');
      await h.join(speaker, roomId, 'Alice', 'vi');
      await h.join(listener, roomId, 'Carol', 'en');
      const audio = {
        lang: 'en',
        sequence: 0,
        sampleRate: 24000,
        // 200 ms of 24 kHz pcm16, base64.
        payload: 'A'.repeat(12_800),
      };
      const subtitle = {
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        sourceText: 'x'.repeat(2000),
        translatedText: 'y'.repeat(2000),
        isFinal: false,
        turnId,
      };

      // Speech delivered twice as fast as real time, a delta every 100 ms.
      for (let tick = 0; tick < 600; tick += 1) {
        vi.setSystemTime(Date.now() + 100);
        h.gateway.handleTranslationBroadcast(speaker, { subtitle, audio });
      }

      expect(speaker.all('conference.translation.broadcast')).toStrictEqual([]);
      expect(listener.all('conference.translation.audio')).toHaveLength(600);
    });

    it('refuses a frame that does not match the contract', async () => {
      const speaker = h.connect('alice');
      await h.join(speaker, roomId, 'Alice', 'vi');

      h.gateway.handleTranslationBroadcast(speaker, {
        subtitle: { sourceText: 'x'.repeat(5000), isFinal: true },
      });

      expect(speaker.last('conference.translation.broadcast')).toStrictEqual({
        error: 'invalid_payload',
      });
      expect(h.prisma.turns).toHaveLength(0);
    });
  });

  describe('chat', () => {
    it('stores the message once in the sender language and rate-limits bursts', async () => {
      const alice = h.connect('alice');
      const carol = h.connect('carol');
      await h.join(alice, roomId, 'Alice', 'vi');
      await h.join(carol, roomId, 'Carol', 'en');

      for (let i = 0; i < CHAT_BURST; i += 1) {
        await h.gateway.handleChat(alice, { text: `tin ${i}` });
      }
      await h.gateway.handleChat(alice, { text: 'one too many' });
      await flush();

      expect(alice.last('conference.chat')).toStrictEqual({
        error: 'limit_reached',
      });
      expect(carol.all('conference.chat.message')).toHaveLength(CHAT_BURST);
      expect(carol.last('conference.chat.message')).toMatchObject({
        text: `[en] tin ${CHAT_BURST - 1}`,
        lang: 'en',
      });
      expect(h.prisma.messages).toHaveLength(CHAT_BURST);
      expect(h.prisma.messages[0]).toMatchObject({
        text: 'tin 0',
        sourceLanguage: 'vi',
      });
    });
  });

  describe('server-initiated endings', () => {
    it('ends the live room when the owner deletes it: conference.ended, then close 4001', async () => {
      const owner = h.connect('alice');
      const guest = h.connect('bob');
      await h.join(owner, roomId, 'Alice', 'vi');
      await h.join(guest, roomId, 'Bob', 'en');

      await h.conferences.end(roomId, 'alice');
      await flush();

      for (const ws of [owner, guest]) {
        expect(ws.last('conference.ended')).toStrictEqual({
          reason: 'ended_by_owner',
        });
        expect(ws.closedWith).toStrictEqual({
          code: CONFERENCE_CLOSE_ENDED,
          reason: 'ended',
        });
        expect(ws._roomId).toBeUndefined();
      }
      expect(h.rooms.getRoom(roomId)).toBeUndefined();
      expect(h.prisma.participants.every((p) => p.status === 'left')).toBe(
        true,
      );

      const late = h.connect('carol');
      expect(await h.join(late, roomId, 'Carol', 'en')).toStrictEqual({
        error: 'room_ended',
      });
    });

    it('closes a revoked user’s conference sockets through SessionTerminator', async () => {
      const ws = h.connect('bob');
      await h.join(ws, roomId, 'Bob', 'en');

      expect(h.terminator.terminate('bob')).toBe(1);
      expect(ws.closedWith?.code).toBe(1008);
    });
  });
});
