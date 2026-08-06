// FIRST, and it must stay first: it pins an env var that `AppModule`'s config
// module reads at import time. See the file for why a hook cannot do this.
import './pin-realtime-provider-env';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import { ProviderRegistry } from '@chatofy/ai-providers';
import type {
  RealtimeStartParams,
  RealtimeStreamEvents,
} from '@chatofy/ai-providers';
import type { LiveServerEvent, ServerEvent } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';

/**
 * Drives /ws/live-translate over a real socket, alongside /ws/translate.
 *
 * The first assertion here is the one the whole phase rests on: NestJS's
 * `WsAdapter` is documented to serve several gateways on distinct paths over one
 * port, but documented is not the same as true in this codebase. Every other
 * file in the continuous path assumes it, so it is proven before anything else.
 *
 * The upstream Gemini session is faked — no key, no network — but the adapter,
 * the gateway, the session state machine and the framing are all real.
 */
describe('/ws/live-translate (e2e)', () => {
  let app: INestApplication;
  let base: string;

  /** The fake upstream, recorded so a test can assert what reached it. */
  const upstream = {
    starts: [] as RealtimeStartParams[],
    pushed: [] as number[],
    closes: 0,
    events: null as RealtimeStreamEvents | null,
  };

  const fakeRealtime = {
    name: 'fake-realtime',
    start: (params: RealtimeStartParams, events: RealtimeStreamEvents) => {
      upstream.starts.push(params);
      upstream.events = events;
      return Promise.resolve({
        id: 'fake-handle',
        close: () => {
          upstream.closes += 1;
          return Promise.resolve();
        },
      });
    },
    pushAudio: (_handle: unknown, chunk: Uint8Array) => {
      upstream.pushed.push(chunk.length);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

    const registry = new ProviderRegistry();
    registry.register('realtime', {
      name: 'gemini-live',
      create: () => fakeRealtime,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(ProviderRegistry)
      .useValue(registry)
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => ({}) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    base = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    upstream.starts.length = 0;
    upstream.pushed.length = 0;
    upstream.closes = 0;
    upstream.events = null;
  });

  class Client {
    readonly events: (LiveServerEvent | ServerEvent)[] = [];

    private constructor(private readonly socket: WebSocket) {
      socket.addEventListener('message', (event) => {
        this.events.push(JSON.parse(String(event.data)) as LiveServerEvent);
      });
    }

    static async connect(target: string): Promise<Client> {
      const socket = new WebSocket(target);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener(
          'error',
          () => reject(new Error(`ws failed: ${target}`)),
          {
            once: true,
          },
        );
      });
      return new Client(socket);
    }

    send(event: string, data: unknown): void {
      this.socket.send(JSON.stringify({ event, data }));
    }

    async waitFor<T extends LiveServerEvent['type']>(
      type: T,
      timeoutMs = 4000,
    ): Promise<Extract<LiveServerEvent, { type: T }>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = this.events.find((e) => e.type === type);
        if (hit) return hit as Extract<LiveServerEvent, { type: T }>;
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${type}; saw [${this.events.map((e) => e.type).join(', ')}]`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    close(): void {
      this.socket.close();
    }
  }

  /** 100 ms of 16 kHz mono pcm16, the shape the client actually captures. */
  const frame = (sequence: number) => ({
    sessionId: 'ignored-by-server',
    encoding: 'pcm16' as const,
    sampleRate: 16000,
    sequence,
    timestamp: Date.now(),
    payload: Buffer.alloc(3200).toString('base64'),
  });

  /**
   * The load-bearing assumption of this whole phase. If one adapter cannot serve
   * two paths, the separate-gateway design is dead and the fallback is a `mode`
   * field on the shared turn contract.
   */
  it('serves both websocket paths on one port', async () => {
    const turn = await Client.connect(`${base}/ws/translate`);
    const live = await Client.connect(`${base}/ws/live-translate`);

    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    // The turn path is untouched while a live session runs.
    turn.send('client.session.start', {
      type: 'client.session.start',
      direction: 'vi_to_en',
      voiceGender: 'female',
    });
    const ready = await new Promise<ServerEvent>((resolve) => {
      const poll = setInterval(() => {
        const hit = turn.events.find((e) => e.type === 'server.session.ready');
        if (hit) {
          clearInterval(poll);
          resolve(hit as ServerEvent);
        }
      }, 10);
    });
    expect(ready.type).toBe('server.session.ready');

    turn.close();
    live.close();
  });

  it('opens the upstream with the direction the client asked for', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'en_to_vi',
    });
    await live.waitFor('server.live.ready');

    expect(upstream.starts).toHaveLength(1);
    expect(upstream.starts[0]).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      audioFormat: { encoding: 'pcm16', sampleRate: 16000, channels: 1 },
    });
    live.close();
  });

  /**
   * The behaviour that distinguishes this path from the turn one. Silent frames
   * are what tell a model with no endpoint event that the speaker stopped;
   * withholding them truncates the translation.
   */
  it('forwards every frame upstream, including silent ones', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    for (let i = 0; i < 4; i += 1) {
      live.send('client.live.audio', {
        type: 'client.live.audio',
        frame: frame(i),
      });
    }
    await new Promise((r) => setTimeout(r, 200));

    // All four, not "the ones that carried speech" — the payload is pure silence.
    expect(upstream.pushed).toEqual([3200, 3200, 3200, 3200]);
    live.close();
  });

  it('frames 24 kHz translated audio back to the client', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    // 500 ms of 24 kHz mono pcm16 → 200 ms frames → 3 frames (200/200/100).
    upstream.events?.onTranslatedAudio?.(new Uint8Array(24000), 24000);
    const audio = await live.waitFor('server.live.audio');

    expect(audio.frame.sampleRate).toBe(24000);
    expect(audio.frame.encoding).toBe('pcm16');
    const frames = live.events.filter((e) => e.type === 'server.live.audio');
    expect(frames).toHaveLength(3);
    live.close();
  });

  it('relays transcripts on separate channels with the detected language', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    upstream.events?.onSourceTranscript?.('Tuy nhiên', 'vi');
    upstream.events?.onTargetTranscript?.('However');
    await new Promise((r) => setTimeout(r, 100));

    const transcripts = live.events.filter(
      (e) => e.type === 'server.live.transcript',
    );
    expect(transcripts).toMatchObject([
      { channel: 'source', delta: 'Tuy nhiên', lang: 'vi' },
      { channel: 'target', delta: 'However', lang: 'en' },
    ]);
    live.close();
  });

  it('refuses audio at a rate the backend does not take', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    live.send('client.live.audio', {
      type: 'client.live.audio',
      frame: { ...frame(0), sampleRate: 48000 },
    });
    const err = await live.waitFor('server.live.error');

    // Refused rather than resampled: the client already captures at 16 kHz, so
    // anything else is a client bug, and resampling would hide it while adding a
    // stage to the latency under measurement.
    expect(err.code).toBe('unsupported_audio');
    expect(upstream.pushed).toEqual([]);
    live.close();
  });

  it('refuses audio before a session is started', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.audio', {
      type: 'client.live.audio',
      frame: frame(0),
    });
    const err = await live.waitFor('server.live.error');
    expect(err.code).toBe('no_live_session');
    live.close();
  });

  it('closes the upstream session when the client stops', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    live.send('client.live.stop', { type: 'client.live.stop' });
    const ended = await live.waitFor('server.live.ended');

    expect(ended.reason).toBe('client_stopped');
    expect(upstream.closes).toBe(1);
    live.close();
  });

  /**
   * Without this, an abandoned tab leaves one socket open to Google per
   * conversation, each holding quota until the remote times it out.
   */
  it('closes the upstream session when the socket drops', async () => {
    const live = await Client.connect(`${base}/ws/live-translate`);
    live.send('client.live.start', {
      type: 'client.live.start',
      direction: 'vi_to_en',
    });
    await live.waitFor('server.live.ready');

    live.close();
    const deadline = Date.now() + 3000;
    while (upstream.closes === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(upstream.closes).toBe(1);
  });
});
