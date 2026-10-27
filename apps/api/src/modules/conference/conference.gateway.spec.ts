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
import type { CloudflareRealtimeClient } from './cloudflare-realtime.client';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceParticipantState } from './conference-participant-state.service';
import { ConferencePeerLifecycle } from './conference-peer-lifecycle.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceService } from './conference.service';
import { ConferenceSfuSignaling } from './conference-sfu-signaling.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { SOCKET_OPEN, type ConferenceSocket } from './conference-socket';
import { CHAT_BURST, ConferenceChat } from './services/conference-chat.service';
import {
  RELAY_CHAR_BURST,
  RELAY_FRAME_BURST,
} from './services/conference-translation-relay.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';
import { ConferenceTranslationRelay } from './services/conference-translation-relay.service';
import { ConferenceTranslationRouter } from './services/conference-translation-router.service';

/**
 * The gateway and every service behind it run for real; only the two edges
 * are doubles — Cloudflare Realtime (a client answering every SFU call) and
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

/** A Cloudflare Realtime client that accepts every call. */
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
          tracks: remotes.map((r, i) => ({ ...r, mid: String(i) })),
        }),
    ),
    renegotiate: vi.fn(() => Promise.resolve()),
    forceCloseTracks: vi.fn(() => Promise.resolve()),
    generateIceServers: vi.fn(() => Promise.resolve(null)),
  };
}

function buildHarness() {
  const prisma = new InMemoryConferencePrisma();
  const cloudflare = fakeCloudflare();
  const translator = {
    translateAll: ({ text, targets }: { text: string; targets: string[] }) =>
      Promise.resolve(
        Object.fromEntries(targets.map((t) => [t, `[${t}] ${text}`])),
      ),
  } as unknown as PipelineTranslatorService;
  const auth = {
    verifyToken: vi.fn().mockResolvedValue({ sub: 'unused' }),
  } as unknown as AuthAdapter;

  const sockets = new ConferenceSocketRegistry();
  const sfu = new ConferenceSfuSignaling(
    cloudflare as unknown as CloudflareRealtimeClient,
    sockets,
  );
  const rooms = new ConferenceRoomRegistry(sfu);
  const conferences = new ConferenceService(prisma.asPrismaService(), rooms);
  const persistence = new ConferencePersistenceService(
    prisma.asPrismaService(),
  );
  const lifecycle = new ConferencePeerLifecycle(
    rooms,
    sockets,
    conferences,
    persistence,
    sfu,
  );
  const participantState = new ConferenceParticipantState(lifecycle, sockets);
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
    sfu,
    participantState,
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
    cloudflare,
    prisma,
    rooms,
    conferences,
    gateway,
    terminator,
    connect,
    join,
  };
}

const publishBody = {
  sdp: 'v=0 offer',
  tracks: [
    { mid: '0', kind: 'audio' },
    { mid: '1', kind: 'video' },
  ],
};

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

    it('tells the room and the joiner which language each peer speaks', async () => {
      const alice = h.connect('alice');
      await h.join(alice, roomId, 'Alice', 'vi');
      const bob = h.connect('bob');

      const reply = await h.join(bob, roomId, 'Bob', 'zh');

      expect(reply).toMatchObject({
        peers: [{ socketId: alice._socketId, sourceLanguage: 'vi' }],
      });
      expect(alice.last('conference.peer.joined')).toMatchObject({
        socketId: bob._socketId,
        sourceLanguage: 'zh',
      });
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

      const second = h.connect('bob');
      const reply = await h.join(second, roomId, 'Bob', 'en');

      expect(reply).toHaveProperty('socketId', second._socketId);
      expect(first.closedWith?.code).toBe(CONFERENCE_CLOSE_REPLACED);
      expect(h.rooms.getRoom(roomId)).toBe(room);
      expect([...(room?.peers.keys() ?? [])]).toStrictEqual([second._socketId]);

      await h.gateway.handleMediaPublish(second, publishBody);
      expect(second.last('conference.media.publish')).toStrictEqual({
        sdp: 'v=0 answer',
      });
    });

    it('refuses a join whose room the owner ended while it was being seated', async () => {
      const ws = h.connect('bob');
      const status = h.conferences.joinableStatus.bind(h.conferences);
      let calls = 0;
      vi.spyOn(h.conferences, 'joinableStatus').mockImplementation(
        async (id) => {
          calls += 1;
          const answer = await status(id);
          // The re-check read `joinable`, then the owner ended the room
          // before the join resumed.
          if (calls === 2) await h.conferences.end(roomId, 'alice');
          return answer;
        },
      );

      const reply = await h.join(ws, roomId, 'Bob', 'en');

      expect(reply).toStrictEqual({ error: 'room_ended' });
      expect(ws._roomId).toBeUndefined();
      expect(h.rooms.getRoom(roomId)).toBeUndefined();
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
      await h.gateway.handleMediaPublish(staying, publishBody);
      expect(staying.last('conference.media.publish')).toHaveProperty('sdp');
    });
  });

  describe('media', () => {
    it('hands a joiner Cloudflare STUN and who already publishes', async () => {
      const alice = h.connect('alice');
      await h.join(alice, roomId, 'Alice', 'vi');
      await h.gateway.handleMediaPublish(alice, publishBody);

      const bob = h.connect('bob');
      const reply = await h.join(bob, roomId, 'Bob', 'en');

      expect(reply).toMatchObject({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        peers: [
          { socketId: alice._socketId, sourceLanguage: 'vi', published: true },
        ],
      });
    });

    it('publishes: replies with the SFU answer and tells the room', async () => {
      const alice = h.connect('alice');
      const bob = h.connect('bob');
      await h.join(alice, roomId, 'Alice', 'vi');
      await h.join(bob, roomId, 'Bob', 'en');

      await h.gateway.handleMediaPublish(alice, publishBody);

      expect(alice.last('conference.media.publish')).toStrictEqual({
        sdp: 'v=0 answer',
      });
      expect(bob.last('conference.media.published')).toStrictEqual({
        socketId: alice._socketId,
      });
    });

    it('subscribes: replies with the SFU offer and the mids, then accepts the answer', async () => {
      const alice = h.connect('alice');
      const bob = h.connect('bob');
      await h.join(alice, roomId, 'Alice', 'vi');
      await h.join(bob, roomId, 'Bob', 'en');
      await h.gateway.handleMediaPublish(alice, publishBody);

      await h.gateway.handleMediaSubscribe(bob, {});
      expect(bob.last('conference.media.subscribe')).toStrictEqual({
        sdp: 'v=0 sfu offer',
        mids: [
          { mid: '0', socketId: alice._socketId, kind: 'audio' },
          { mid: '1', socketId: alice._socketId, kind: 'video' },
        ],
      });

      await h.gateway.handleMediaRenegotiate(bob, { sdp: 'v=0 answer' });
      expect(bob.last('conference.media.renegotiate')).toStrictEqual({
        ok: true,
      });
    });

    it('refuses media events from a socket that has not joined', async () => {
      const ws = h.connect('bob');

      await h.gateway.handleMediaPublish(ws, publishBody);
      await h.gateway.handleMediaSubscribe(ws, {});
      await h.gateway.handleMediaRenegotiate(ws, { sdp: 'v=0 answer' });

      for (const event of [
        'conference.media.publish',
        'conference.media.subscribe',
        'conference.media.renegotiate',
      ]) {
        expect(ws.last(event)).toStrictEqual({ error: 'not_in_room' });
      }
      expect(h.cloudflare.newSession).not.toHaveBeenCalled();
    });

    it('refuses a media payload that does not match the contract', async () => {
      const ws = h.connect('bob');
      await h.join(ws, roomId, 'Bob', 'en');

      await h.gateway.handleMediaPublish(ws, {
        sdp: 'v=0 offer',
        tracks: [
          { mid: '0', kind: 'video' },
          { mid: '1', kind: 'video' },
        ],
      });
      await h.gateway.handleMediaRenegotiate(ws, { sdp: '' });

      expect(ws.last('conference.media.publish')).toStrictEqual({
        error: 'invalid_payload',
      });
      expect(ws.last('conference.media.renegotiate')).toStrictEqual({
        error: 'invalid_payload',
      });
      expect(h.cloudflare.pushTracks).not.toHaveBeenCalled();
    });

    it('closes a leaver’s SFU tracks when its socket disconnects', async () => {
      const alice = h.connect('alice');
      const bob = h.connect('bob');
      await h.join(alice, roomId, 'Alice', 'vi');
      await h.join(bob, roomId, 'Bob', 'en');
      await h.gateway.handleMediaPublish(alice, publishBody);

      h.gateway.handleDisconnect(alice);
      await flush();

      expect(h.cloudflare.forceCloseTracks).toHaveBeenCalledWith('sess-1', [
        '0',
        '1',
      ]);
      expect(bob.last('conference.peer.left')).toStrictEqual({
        socketId: alice._socketId,
      });
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

    describe('a subtitle translated into several languages', () => {
      /** A vi speaker with an en, a zh and a second vi listener. */
      async function threeLanguageRoom() {
        const speaker = h.connect('alice');
        const en = h.connect('bob');
        const zh = h.connect('carol');
        const vi = h.connect('dave');
        await h.join(speaker, roomId, 'Alice', 'vi');
        await h.join(en, roomId, 'Bob', 'en');
        await h.join(zh, roomId, 'Carol', 'zh');
        await h.join(vi, roomId, 'Dave', 'vi');
        return { speaker, en, zh, vi };
      }
      const subtitle = (
        isFinal: boolean,
        translations: Record<string, string> | undefined,
        overrides: Record<string, unknown> = {},
      ) => ({
        subtitle: {
          sourceLanguage: 'vi',
          targetLanguage: 'en',
          sourceText: 'xin chào',
          translatedText: translations?.en ?? 'hello',
          ...(translations ? { translations } : {}),
          isFinal,
          turnId,
          ...overrides,
        },
      });

      it('narrows the frame to each listener’s language and never forwards the map', async () => {
        const { speaker, en, zh, vi } = await threeLanguageRoom();

        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(false, { en: 'hello', zh: '你好' }),
        );

        const common = {
          sourceLanguage: 'vi',
          sourceText: 'xin chào',
          isFinal: false,
          turnId,
          speakerSocketId: speaker._socketId,
          speakerDisplayName: 'Alice',
        };
        expect(en.all('conference.translation.subtitle')).toStrictEqual([
          { ...common, targetLanguage: 'en', translatedText: 'hello' },
        ]);
        expect(zh.all('conference.translation.subtitle')).toStrictEqual([
          { ...common, targetLanguage: 'zh', translatedText: '你好' },
        ]);
        // Same language as the speaker, and the speaker: nothing.
        expect(vi.all('conference.translation.subtitle')).toHaveLength(0);
        expect(speaker.all('conference.translation.subtitle')).toHaveLength(0);
      });

      it('gives a listener whose language is not in the map yet the source text, final or not', async () => {
        const { speaker, zh } = await threeLanguageRoom();

        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(false, { en: 'hel' }),
        );
        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(true, { en: 'hello' }),
        );

        expect(
          zh.all('conference.translation.subtitle').map((frame) => ({
            targetLanguage: frame.targetLanguage,
            translatedText: frame.translatedText,
            isFinal: frame.isFinal,
          })),
        ).toStrictEqual([
          { targetLanguage: 'zh', translatedText: 'xin chào', isFinal: false },
          { targetLanguage: 'zh', translatedText: 'xin chào', isFinal: true },
        ]);
      });

      it('delivers a frame without a map unchanged, as a single-language speaker sends it', async () => {
        const { speaker, en, zh } = await threeLanguageRoom();

        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(false, undefined),
        );

        const unchanged = {
          sourceLanguage: 'vi',
          targetLanguage: 'en',
          sourceText: 'xin chào',
          translatedText: 'hello',
          isFinal: false,
          turnId,
          speakerSocketId: speaker._socketId,
          speakerDisplayName: 'Alice',
        };
        expect(en.all('conference.translation.subtitle')).toStrictEqual([
          unchanged,
        ]);
        expect(zh.all('conference.translation.subtitle')).toStrictEqual([
          unchanged,
        ]);
      });

      it('stores the map filtered to the other languages in the room, once per turn', async () => {
        const speaker = h.connect('alice');
        const en = h.connect('bob');
        const zh = h.connect('carol');
        await h.join(speaker, roomId, 'Alice', 'vi');
        await h.join(en, roomId, 'Bob', 'en');
        await h.join(zh, roomId, 'Carol', 'zh');
        // Carol leaves before the turn ends, so nobody in the room reads zh.
        h.gateway.handleDisconnect(zh);

        const final = subtitle(true, {
          en: ' hello ',
          zh: '你好',
          vi: 'xin chào',
        });
        final.subtitle.translatedText = ' hello ';
        h.gateway.handleTranslationBroadcast(speaker, final);
        h.gateway.handleTranslationBroadcast(speaker, final);
        await flush();

        expect(h.prisma.turns).toHaveLength(1);
        expect(h.prisma.turns[0]).toMatchObject({
          sourceLanguage: 'vi',
          sourceText: 'xin chào',
          translations: { en: 'hello' },
        });
        expect(h.prisma.turns[0]?.searchText).not.toContain('你好');
      });

      it('stores every language present, and searches across all of them', async () => {
        const { speaker } = await threeLanguageRoom();

        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(true, { en: 'hello', zh: '你好' }),
        );
        await flush();

        expect(h.prisma.turns).toHaveLength(1);
        const [row] = h.prisma.turns;
        expect(row?.translations).toStrictEqual({ en: 'hello', zh: '你好' });
        expect(row?.searchText).toContain('hello');
        expect(row?.searchText).toContain('你好');
      });

      it('refuses a frame whose map disagrees with its translatedText, routing and storing nothing', async () => {
        const { speaker, en, zh } = await threeLanguageRoom();

        h.gateway.handleTranslationBroadcast(
          speaker,
          subtitle(
            true,
            { en: 'hello', zh: '你好' },
            { translatedText: 'goodbye' },
          ),
        );
        await flush();

        expect(speaker.last('conference.translation.broadcast')).toStrictEqual({
          error: 'invalid_payload',
        });
        expect(en.all('conference.translation.subtitle')).toHaveLength(0);
        expect(zh.all('conference.translation.subtitle')).toHaveLength(0);
        expect(h.prisma.turns).toHaveLength(0);
      });

      it('counts the map against the relay budget', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { speaker, en } = await threeLanguageRoom();
        const long = 'x'.repeat(4000);
        const heavy = subtitle(
          false,
          { en: long, zh: long },
          { sourceText: long, translatedText: long },
        );
        // 16 k chars per frame with the map, 8 k without it.
        const perFrame = 16_000;
        const allowed = Math.floor(RELAY_CHAR_BURST / perFrame);

        for (let i = 0; i <= allowed; i += 1) {
          h.gateway.handleTranslationBroadcast(speaker, heavy);
        }

        // Below the frame ceiling, so only the characters can have refused it.
        expect(allowed).toBeLessThan(RELAY_FRAME_BURST);
        expect(en.all('conference.translation.subtitle')).toHaveLength(allowed);
        expect(speaker.last('conference.translation.broadcast')).toStrictEqual({
          error: 'limit_reached',
        });
      });
    });

    it('lets a cascade burst through: three 8 s turns voiced in two languages, with subtitle deltas', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const speaker = h.connect('alice');
      const en = h.connect('bob');
      const zh = h.connect('carol');
      await h.join(speaker, roomId, 'Alice', 'vi');
      await h.join(en, roomId, 'Bob', 'en');
      await h.join(zh, roomId, 'Carol', 'zh');
      const turnIds = [
        '5b0c8f0e-7c1a-4a7e-9d0b-1f2e3d4c5b61',
        '5b0c8f0e-7c1a-4a7e-9d0b-1f2e3d4c5b62',
        '5b0c8f0e-7c1a-4a7e-9d0b-1f2e3d4c5b63',
      ];
      const text = 'x'.repeat(400);

      // All at one instant: the server delivers a turn's speech far faster
      // than real time, and the leg relays every frame as it arrives.
      for (const id of turnIds) {
        for (let delta = 0; delta < 40; delta += 1) {
          h.gateway.handleTranslationBroadcast(speaker, {
            subtitle: {
              sourceLanguage: 'vi',
              targetLanguage: 'en',
              sourceText: text,
              translatedText: text,
              translations: { en: text, zh: text },
              isFinal: false,
              turnId: id,
            },
          });
        }
        for (const lang of ['en', 'zh']) {
          // 8 s of 24 kHz pcm16 in 200 ms frames.
          for (let sequence = 0; sequence < 40; sequence += 1) {
            h.gateway.handleTranslationBroadcast(speaker, {
              audio: {
                lang,
                sequence,
                sampleRate: 24000,
                payload: 'A'.repeat(12_800),
              },
            });
          }
        }
      }

      expect(speaker.all('conference.translation.broadcast')).toStrictEqual([]);
      expect(en.all('conference.translation.audio')).toHaveLength(120);
      expect(zh.all('conference.translation.audio')).toHaveLength(120);
      expect(zh.all('conference.translation.subtitle')).toHaveLength(120);
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
