import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { WS_SUBPROTOCOL } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';

/**
 * The Phase-4 conference chat path, proven end to end over a real /ws/conference
 * socket: a message sent in one participant's language arrives at each recipient
 * in THEIR language, while the sender hears their own original back.
 *
 * Hermetic — no browser, no WebRTC, no DB, no network, no key. The translation
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
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
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
    const room = 'smoke-room';
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
    const room = 'smoke-room-2';
    const aliceClient = await ConferenceClient.connect(alice);
    const bobClient = await ConferenceClient.connect(bob);

    const aliceId = await join(aliceClient, room, 'Alice', 'vi');
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
});
