import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// /ws/translate metered against the REAL credit ledger.
//
// The app boots whole on Postgres and Redis with only the AI providers faked,
// and is driven over a real socket: admission, the per-frame count of accepted
// audio, the stop when credit runs out, the settle on turn end and on a dropped
// socket, and a lease the reaper took while the socket idled.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CREDIT_SECONDS_PER_CREDIT, type ServerEvent } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';
import { encodePcm16Wav } from '../src/modules/translate/audio/wav-codec';
import { billingMonthKey } from '../src/modules/credits/billing-period';
import {
  CREDIT_LEDGER,
  type CreditLedgerPort,
} from '../src/modules/credits/credit-ledger.port';
import { CreditLeaseReaper } from '../src/modules/credits/credit-lease-reaper';
import { TranslateGateway } from '../src/modules/translate/translate.gateway';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FREE = 120 * CREDIT_SECONDS_PER_CREDIT;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Default turns speak their translation: 2 credit-seconds per accepted second. */
const VOICE = 2;
/** One frame is 100 ms of 16 kHz mono PCM16. */
const FRAME_SECONDS = 0.1;
/** What `frames` voiced frames cost, in whole credit-seconds as the ledger stores them. */
const credit = (frames: number) => Math.round(frames * FRAME_SECONDS * VOICE);

describe('metered /ws/translate (db-e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let ledger: CreditLedgerPort;
  let reaper: CreditLeaseReaper;
  let url: string;
  const users: Identity[] = [];

  const ttsPcm = Buffer.alloc(12000 * 2);
  const ttsWav = encodePcm16Wav({
    samples: ttsPcm,
    sampleRate: 24000,
    channels: 1,
  });
  const fakeProviders = {
    stt: {
      name: 'fake-stt',
      transcribe: vi
        .fn()
        .mockResolvedValue({ text: 'xin chào', language: 'vi' }),
      supportedLanguages: vi.fn().mockResolvedValue({
        known: ['vi', 'en', 'zh'],
        unknown: [],
        identifiable: ['vi', 'en'],
      }),
    },
    translation: {
      name: 'fake-translation',
      translate: vi.fn().mockResolvedValue({ text: 'Hello.' }),
    },
    tts: {
      name: 'fake-tts',
      outputMimeType: 'audio/wav',
      synthesize: vi.fn().mockResolvedValue(new Uint8Array(ttsWav)),
    },
  };

  /** A fresh account whose whole balance is `creditSeconds`, as this month's Free grant. */
  async function account(name: string, creditSeconds?: number) {
    const identity = await registerAndLogin(app, {
      email: `meter-${name}-${run}@db-e2e.example.com`,
    });
    users.push(identity);
    if (creditSeconds !== undefined) {
      // Written under the Free grant's own key, so the ledger finds this
      // month's Free already granted and adds nothing beside it.
      await ledger.grant({
        userId: identity.userId,
        source: 'free',
        planCode: 'free',
        amount: creditSeconds,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        externalRef: `free:${identity.userId}:${billingMonthKey(new Date())}`,
      });
    }
    return identity;
  }

  const settles = (userId: string) =>
    prisma.creditEntry.findMany({
      where: { userId, kind: 'settle' },
      orderBy: { createdAt: 'asc' },
    });
  const settled = async (userId: string) =>
    (await settles(userId)).reduce((sum, e) => sum - e.amount, 0);
  const openLeases = (userId: string) =>
    prisma.creditLease.count({ where: { userId, status: 'open' } });
  /** Waits until the user's lease is closed: `detach` runs after the socket goes. */
  async function leaseClosed(userId: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while ((await openLeases(userId)) > 0) {
      if (Date.now() > deadline) throw new Error('lease never closed');
      await sleep(25);
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => fakeProviders })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    prisma = app.get(PrismaService);
    ledger = app.get<CreditLedgerPort>(CREDIT_LEDGER);
    reaper = app.get(CreditLeaseReaper);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}/ws/translate`;
  });

  afterAll(async () => {
    const ids = users.map((u) => u.userId);
    await prisma.creditEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditLease.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditGrant.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  class Client {
    readonly events: ServerEvent[] = [];
    private constructor(private readonly socket: WebSocket) {
      socket.addEventListener('message', (event) => {
        this.events.push(JSON.parse(String(event.data)) as ServerEvent);
      });
    }

    static async connect(identity: Identity): Promise<Client> {
      const socket = new WebSocket(url, identity.subprotocols);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener(
          'error',
          () => reject(new Error('ws failed to open')),
          { once: true },
        );
      });
      return new Client(socket);
    }

    send(event: string, data: Record<string, unknown>): void {
      this.socket.send(
        JSON.stringify({ event, data: { type: event, ...data } }),
      );
    }

    start(turnId: string, extra: Record<string, unknown> = {}): void {
      this.send('client.session.start', {
        languagePair: { source: 'vi', target: 'en' },
        turnId,
        ...extra,
      });
    }

    frame(sessionId: string, sequence: number): void {
      this.send('client.audio.frame', {
        frame: {
          sessionId,
          encoding: 'pcm16',
          sampleRate: 16000,
          sequence,
          timestamp: Date.now(),
          payload: Buffer.alloc(1600 * 2).toString('base64'),
        },
      });
    }

    errors(code: string): Extract<ServerEvent, { type: 'server.error' }>[] {
      return this.events.filter(
        (e): e is Extract<ServerEvent, { type: 'server.error' }> =>
          e.type === 'server.error' && e.code === code,
      );
    }

    async waitFor<T extends ServerEvent['type']>(
      type: T,
      match: (event: Extract<ServerEvent, { type: T }>) => boolean = () => true,
      timeoutMs = 8000,
    ): Promise<Extract<ServerEvent, { type: T }>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = this.events.find(
          (e) =>
            e.type === type && match(e as Extract<ServerEvent, { type: T }>),
        );
        if (hit) return hit as Extract<ServerEvent, { type: T }>;
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${type}; saw [${this.events.map((e) => e.type).join(', ')}]`,
          );
        }
        await sleep(10);
      }
    }

    /** A turn the server opened; returns its session id. */
    async open(turnId: string, extra: Record<string, unknown> = {}) {
      this.start(turnId, extra);
      const ready = await this.waitFor(
        'server.session.ready',
        (e) => e.turnId === turnId,
      );
      return ready.sessionId;
    }

    /** End a turn and wait for the server to close it. */
    async end(sessionId: string) {
      this.send('client.session.end', { sessionId });
      return this.waitFor(
        'server.session.ended',
        (e) => e.sessionId === sessionId,
      );
    }

    close(): void {
      this.socket.close();
    }
  }

  /**
   * Drop a user's connection with no closing handshake, as a killed tab or a
   * lost network does. The client API cannot do that, so the server-side
   * socket is terminated, which destroys the TCP connection at once.
   */
  function terminate(userId: string): void {
    // The registry is private; this reaches it only to find the live socket.
    const gateway = app.get<unknown>(TranslateGateway) as {
      socketsByUser: Map<string, Set<{ terminate(): void }>>;
    };
    const held = [...(gateway.socketsByUser.get(userId) ?? [])];
    expect(held).toHaveLength(1);
    held[0]!.terminate();
  }

  it('refuses a start from a user holding 0.9 credits', async () => {
    const user = await account('point-nine', 54);
    const client = await Client.connect(user);
    try {
      client.start('turn-a');
      const refused = await client.waitFor('server.error');
      expect(refused).toMatchObject({
        code: 'credits_exhausted',
        turnId: 'turn-a',
        remainingCreditSeconds: 54,
      });
      expect(client.events.some((e) => e.type === 'server.session.ready')).toBe(
        false,
      );
    } finally {
      client.close();
    }
  });

  it('warns, then stops a 1-credit user mid-turn and bills only accepted audio', async () => {
    const user = await account('one-credit', CREDIT_SECONDS_PER_CREDIT);
    const client = await Client.connect(user);
    const sent = 900; // 90 s of audio
    try {
      const sessionId = await client.open('turn-b');
      // At or under two credits from the start: a notice, nothing ends.
      expect(client.errors('credits_low')).toHaveLength(1);
      // Paced at ten times real time, so the stop lands while audio still flows.
      for (let i = 0; i < sent; i += 1) {
        client.frame(sessionId, i);
        if (i % 10 === 9) await sleep(10);
      }
      const exhausted = await client.waitFor(
        'server.error',
        (e) => e.code === 'credits_exhausted',
      );
      expect(exhausted.turnId).toBeUndefined();
      expect(exhausted.sessionId).toBeUndefined();
      const ended = await client.waitFor(
        'server.session.ended',
        (e) => e.sessionId === sessionId,
      );
      expect(ended.reason).toBe('credits_exhausted');
      // What was said before the stop is still translated.
      await client.waitFor('server.transcript.final');
      expect(client.errors('credits_low')).toHaveLength(1);
      expect(client.errors('credits_exhausted')).toHaveLength(1);
    } finally {
      client.close();
    }
    await leaseClosed(user.userId);

    // Every frame after the stop was refused: busy while the turn translated,
    // then naming a turn the socket no longer holds once it closed.
    const refused = ['session_busy', 'frame_rejected', 'no_active_session']
      .map((code) => client.errors(code).length)
      .reduce((a, b) => a + b, 0);
    const accepted = sent - refused;
    expect(accepted).toBeLessThan(sent);
    const total = await settled(user.userId);
    expect(total).toBe(credit(accepted));
    // Never charged past the balance; any overshoot is recorded, uncharged,
    // and smaller than one lease.
    const entries = await settles(user.userId);
    const uncovered = entries
      .filter((e) => e.reason === 'overshoot_uncovered')
      .reduce((sum, e) => sum - e.amount, 0);
    expect(total - uncovered).toBe(CREDIT_SECONDS_PER_CREDIT);
    expect(uncovered).toBeLessThan(120 * VOICE);
    expect((await ledger.balance(user.userId)).available).toBe(0);
  }, 30_000);

  it('closes the lease of a socket dropped mid-turn and bills the frames it accepted', async () => {
    const user = await account('dropped');
    const client = await Client.connect(user);
    const sessionId = await client.open('turn-c');
    for (let i = 0; i < 50; i += 1) client.frame(sessionId, i);
    // A preview frame-level read happens per frame; give the server the burst.
    await sleep(300);
    expect(client.errors('session_busy')).toHaveLength(0);
    terminate(user.userId);
    await leaseClosed(user.userId);

    expect(await settled(user.userId)).toBe(credit(50));
    expect((await ledger.balance(user.userId)).available).toBe(
      FREE - credit(50),
    );
  });

  it('the reaper releases the lease of a connection that died without closing it', async () => {
    const user = await account('crashed');
    const lease = await ledger.openLease(user.userId, 240);
    expect((await ledger.balance(user.userId)).available).toBe(FREE - 240);
    await prisma.creditLease.update({
      where: { id: lease.leaseId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await reaper.tick();
    const row = await prisma.creditLease.findUniqueOrThrow({
      where: { id: lease.leaseId },
    });
    expect(row.status).toBe('reaped');
    expect((await ledger.balance(user.userId)).available).toBe(FREE);
  });

  it('settles a second turn on a reopened lease after the first was reaped while idle', async () => {
    const user = await account('idle');
    const client = await Client.connect(user);
    const first = await client.open('turn-1');
    for (let i = 0; i < 20; i += 1) client.frame(first, i);
    expect((await client.end(first)).reason).toBe('completed');
    await sleep(100);

    // Idle past the lease: the reaper takes it back.
    const [reaped] = await prisma.creditLease.findMany({
      where: { userId: user.userId, status: 'open' },
    });
    await prisma.creditLease.update({
      where: { id: reaped!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await reaper.tick();

    const second = await client.open('turn-2');
    for (let i = 0; i < 30; i += 1) client.frame(second, i);
    await sleep(300);
    client.close();
    // No lease is open after the reap, so wait on the settle itself: the
    // disconnect reopens one to settle on, then closes it.
    const deadline = Date.now() + 5000;
    while ((await settles(user.userId)).length < 2) {
      if (Date.now() > deadline) throw new Error('second turn never settled');
      await sleep(25);
    }
    await leaseClosed(user.userId);

    const entries = await settles(user.userId);
    expect(entries.map((e) => -e.amount)).toEqual([credit(20), credit(30)]);
    expect(entries[1]!.leaseId).not.toBe(reaped!.id);
    // The reaped lease was released by the reaper alone, and the balance is
    // down by exactly the audio of both turns: nothing was released twice.
    const reapedRow = await prisma.creditLease.findUniqueOrThrow({
      where: { id: reaped!.id },
    });
    expect(reapedRow.status).toBe('reaped');
    expect((await ledger.balance(user.userId)).available).toBe(
      FREE - credit(20) - credit(30),
    );
  }, 20_000);

  it('writes the conversation id a start carried on its settle, and null when none', async () => {
    const user = await account('conversation');
    const client = await Client.connect(user);
    try {
      const labelled = await client.open('turn-x', {
        conversationId: `conv-${run}`,
      });
      for (let i = 0; i < 10; i += 1) client.frame(labelled, i);
      await client.end(labelled);
      const plain = await client.open('turn-y');
      for (let i = 0; i < 10; i += 1) client.frame(plain, i);
      await client.end(plain);
    } finally {
      client.close();
    }
    await leaseClosed(user.userId);
    const entries = await settles(user.userId);
    expect(entries.map((e) => e.conversationId)).toEqual([`conv-${run}`, null]);
    expect(entries.every((e) => e.sessionId)).toBe(true);
  });
});
