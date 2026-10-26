import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Meetings always load; the SFU app id and secret come from setup-env.ts. Chat
// never reaches Cloudflare, and with the TURN key deleted a join's ICE servers
// are STUN only, so nothing is fetched. This must run before the imports
// below, which `vi.hoisted` guarantees.
vi.hoisted(() => {
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { WS_SUBPROTOCOL } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';
import { InMemoryConferencePrisma } from './utils/in-memory-conference-prisma';

/**
 * The Phase-4 conference chat path, proven end to end over a real /ws/conference
 * socket: a message sent in one participant's language arrives at each recipient
 * in THEIR language, while the sender hears their own original back.
 *
 * Rooms are minted through `POST /conference` first, as the clients do: the
 * gateway never creates one, so a join to an id the API did not mint fails.
 *
 * Hermetic — no browser, no WebRTC, no DB, no network, no key. Conference rows
 * live in the in-memory conference store, which keeps Postgres's key and
 * visibility rules. The translation
 * backend is faked to echo `[<target>] <text>`, so an assertion on the delivered
 * text proves per-recipient routing and translation without a live model: a
 * vi→en delivery that reads `[en] …` could only have gone through the target the
 * gateway chose for that recipient.
 */
describe('/ws/conference chat translation (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let alice: Identity;
  let bob: Identity;
  const prisma = new InMemoryConferencePrisma();

  /**
   * The crux. The gateway's chat handler calls
   * PipelineTranslatorService.translateAll, which reaches
   * trio.translation.translate({ text, sourceLanguage, targetLanguage, ... })
   * and reads back `{ text, model }`. This fake returns deterministically, so
   * the delivered text names the target it was translated for.
   */
  const fakeTranslation = {
    name: 'fake-translation',
    translate: (req: {
      text: string;
      sourceLanguage: string;
      targetLanguage: string;
    }) =>
      Promise.resolve({
        text: `[${req.targetLanguage}] ${req.text}`,
        model: 'fake',
      }),
  };

  beforeAll(async () => {
    const registry = new ProviderRegistry();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(ProviderRegistry)
      .useValue(registry)
      // makeProviders returns the trio; the chat path only ever touches
      // `.translation`, so that is the only member the fake has to supply.
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => ({ translation: fakeTranslation }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    alice = await registerAndLogin(app);
    bob = await registerAndLogin(app);
    const address = app.getHttpServer().address() as AddressInfo;
    base = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Mint a room through the REST API, the only way a room comes to exist. */
  async function createRoom(owner: Identity): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/conference')
      .set('Authorization', owner.bearer)
      .send({})
      .expect(201);
    const body = res.body as { data: { id: string; status: string } };
    expect(body.data.status).toBe('waiting');
    return body.data.id;
  }

  /** One frame received on a conference socket: `{ event, data }`. */
  interface Frame {
    event: string;
    data: Record<string, unknown>;
  }

  /** A connected conference socket that records every frame it receives. */
  class ConferenceClient {
    readonly frames: Frame[] = [];

    private constructor(private readonly socket: WebSocket) {
      socket.addEventListener('message', (event) => {
        this.frames.push(JSON.parse(String(event.data)) as Frame);
      });
    }

    static async connect(identity: Identity): Promise<ConferenceClient> {
      const socket = new WebSocket(`${base}/ws/conference`, [
        WS_SUBPROTOCOL,
        identity.accessToken,
      ]);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener(
          'error',
          () => reject(new Error('ws failed to open')),
          { once: true },
        );
      });
      return new ConferenceClient(socket);
    }

    send(event: string, data: unknown): void {
      this.socket.send(JSON.stringify({ event, data }));
    }

    /**
     * Resolve with the first frame of `event` whose data satisfies `match`,
     * polling the recorded frames. `match` lets a test wait past its own echo
     * for the specific copy it cares about.
     */
    async waitFor(
      event: string,
      match: (data: Record<string, unknown>) => boolean = () => true,
      timeoutMs = 5000,
    ): Promise<Frame> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = this.frames.find((f) => f.event === event && match(f.data));
        if (hit) return hit;
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${event}; saw [${this.frames
              .map((f) => f.event)
              .join(', ')}]`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    /** Resolves with the close code once the server ends the connection. */
    closed(): Promise<number> {
      return new Promise((resolve) => {
        if (this.socket.readyState === WebSocket.CLOSED) resolve(1006);
        this.socket.addEventListener('close', (e) => resolve(e.code), {
          once: true,
        });
      });
    }

    close(): void {
      this.socket.close();
    }
  }

  /**
   * Join a room and return the socketId the gateway assigned, from the join
   * reply. The reply carries no error when the join succeeded.
   */
  async function join(
    client: ConferenceClient,
    roomId: string,
    displayName: string,
    sourceLanguage: string,
  ): Promise<string> {
    client.send('conference.join', { roomId, displayName, sourceLanguage });
    const reply = await client.waitFor('conference.join');
    expect(reply.data.error).toBeUndefined();
    return reply.data.socketId as string;
  }

  it('delivers a vi message to an en recipient translated, and echoes the original to the sender', async () => {
    const room = await createRoom(alice);
    const aliceClient = await ConferenceClient.connect(alice);
    const bobClient = await ConferenceClient.connect(bob);

    const aliceId = await join(aliceClient, room, 'Alice', 'vi');
    await join(bobClient, room, 'Bob', 'en');

    aliceClient.send('conference.chat', { text: 'xin chào mọi người' });

    // Bob (en) receives Alice's (vi) message translated into en.
    const atBob = await bobClient.waitFor(
      'conference.chat.message',
      (d) => d.socketId === aliceId,
    );
    expect(atBob.data).toMatchObject({
      socketId: aliceId,
      displayName: 'Alice',
      text: '[en] xin chào mọi người',
      lang: 'en',
    });

    // Alice's own socket receives the reply in her own language, untranslated.
    const atAlice = await aliceClient.waitFor(
      'conference.chat.message',
      (d) => d.socketId === aliceId,
    );
    expect(atAlice.data).toMatchObject({
      socketId: aliceId,
      displayName: 'Alice',
      text: 'xin chào mọi người',
      lang: 'vi',
    });

    // Same logical message: one id across the sender echo and the recipient copy.
    expect(atBob.data.id).toBe(atAlice.data.id);

    aliceClient.close();
    bobClient.close();
  });

  it('translates the other direction too (en message → vi recipient)', async () => {
    const room = await createRoom(bob);
    const aliceClient = await ConferenceClient.connect(alice);
    const bobClient = await ConferenceClient.connect(bob);

    await join(aliceClient, room, 'Alice', 'vi');
    const bobId = await join(bobClient, room, 'Bob', 'en');

    bobClient.send('conference.chat', { text: 'hello everyone' });

    const atAlice = await aliceClient.waitFor(
      'conference.chat.message',
      (d) => d.socketId === bobId,
    );
    expect(atAlice.data).toMatchObject({
      socketId: bobId,
      displayName: 'Bob',
      text: '[vi] hello everyone',
      lang: 'vi',
    });

    aliceClient.close();
    bobClient.close();
  });

  it('refuses to join a room id the API never minted', async () => {
    const client = await ConferenceClient.connect(alice);

    client.send('conference.join', {
      roomId: 'cneverminted00000000',
      displayName: 'Alice',
      sourceLanguage: 'vi',
    });

    const reply = await client.waitFor('conference.join');
    expect(reply.data).toStrictEqual({ error: 'room_not_found' });
    client.close();
  });

  it('drops a socket that sends a frame over the 512 KiB cap', async () => {
    const client = await ConferenceClient.connect(alice);
    const closed = client.closed();

    client.send('conference.chat', { text: 'x'.repeat(600 * 1024) });

    // 1009: message too big — refused by ws before any handler parses it.
    expect(await closed).toBe(1009);
  });

  it('stores each chat message once, in the sender language', async () => {
    const room = await createRoom(alice);
    const aliceClient = await ConferenceClient.connect(alice);
    const bobClient = await ConferenceClient.connect(bob);
    await join(aliceClient, room, 'Alice', 'vi');
    const bobId = await join(bobClient, room, 'Bob', 'en');

    bobClient.send('conference.chat', { text: 'stored once' });
    await aliceClient.waitFor(
      'conference.chat.message',
      (d) => d.socketId === bobId,
    );

    expect(
      prisma.messages.filter((m) => m.conferenceId === room),
    ).toMatchObject([{ text: 'stored once', sourceLanguage: 'en' }]);
    aliceClient.close();
    bobClient.close();
  });
});
