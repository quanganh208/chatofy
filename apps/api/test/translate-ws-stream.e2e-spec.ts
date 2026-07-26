import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import type { ServerEvent } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';
import { encodePcm16Wav } from '../src/modules/translate/audio/wav-codec';

/**
 * Drives /ws/translate over a real socket.
 *
 * Unit tests call the gateway directly, which cannot prove the part most likely
 * to be wrong: the wire format Nest's WsAdapter expects (`{event, data}`), and
 * that `@ConnectedSocket()` really resolves to the connection. Only a live
 * socket exercises that, so this boots the app on a real port and speaks to it.
 *
 * Providers are faked — no sidecars, no API keys — but the pipeline, session
 * state machine and adapter are all real.
 */
describe('/ws/translate (e2e)', () => {
  let app: INestApplication;
  let url: string;

  /** 0.5s of synthesized speech the sidecar would have returned. */
  const ttsPcm = Buffer.alloc(12000 * 2);
  for (let i = 0; i < 12000; i++)
    ttsPcm.writeInt16LE(((i * 977) % 4096) - 2048, i * 2);
  const ttsWav = encodePcm16Wav({
    samples: ttsPcm,
    sampleRate: 24000,
    channels: 1,
  });

  const fakeProviders = {
    stt: {
      name: 'fake-stt',
      transcribe: jest
        .fn()
        .mockResolvedValue({ text: 'xin chào', language: 'vi' }),
    },
    translation: {
      name: 'fake-translation',
      // Two clauses, so the streaming path's per-clause synthesis is exercised
      // rather than the degenerate single-part case.
      translate: jest.fn().mockResolvedValue({ text: 'Hello, how are you?' }),
    },
    tts: {
      name: 'fake-tts',
      outputMimeType: 'audio/wav',
      synthesize: jest.fn().mockResolvedValue(new Uint8Array(ttsWav)),
    },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => fakeProviders })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    // A real port: the point of this suite is to speak the actual protocol.
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}/ws/translate`;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A live connection that records every server event it receives. */
  class Client {
    private readonly socket: WebSocket;
    readonly events: ServerEvent[] = [];

    private constructor(socket: WebSocket) {
      this.socket = socket;
      this.socket.addEventListener('message', (event) => {
        this.events.push(JSON.parse(String(event.data)) as ServerEvent);
      });
    }

    static async connect(target: string): Promise<Client> {
      const socket = new WebSocket(target);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener(
          'error',
          () => reject(new Error('ws failed to open')),
          {
            once: true,
          },
        );
      });
      return new Client(socket);
    }

    /** The adapter dispatches on `event` and passes `data` to the handler. */
    send(event: string, data: unknown): void {
      this.socket.send(JSON.stringify({ event, data }));
    }

    /** Wait until an event of this type arrives, or fail loudly. */
    async waitFor<T extends ServerEvent['type']>(
      type: T,
      timeoutMs = 4000,
    ): Promise<Extract<ServerEvent, { type: T }>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = this.events.find((e) => e.type === type);
        if (hit) return hit as Extract<ServerEvent, { type: T }>;
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

  /** One 100ms frame of 16 kHz mono PCM16. */
  const frame = (sessionId: string, sequence: number) => ({
    type: 'client.audio.frame',
    frame: {
      sessionId,
      encoding: 'pcm16',
      sampleRate: 16000,
      sequence,
      timestamp: Date.now(),
      payload: Buffer.alloc(1600 * 2).toString('base64'),
    },
  });

  it('carries a whole turn from session.start to session.ended', async () => {
    const client = await Client.connect(url);
    try {
      client.send('client.session.start', {
        type: 'client.session.start',
        direction: 'vi_to_en',
      });
      const { sessionId } = await client.waitFor('server.session.ready');
      expect(sessionId).toEqual(expect.any(String));

      client.send('client.audio.frame', frame(sessionId, 0));
      client.send('client.audio.frame', frame(sessionId, 1));
      client.send('client.session.end', { type: 'client.session.end' });

      const transcript = await client.waitFor('server.transcript.final');
      expect(transcript.segment).toMatchObject({
        sessionId,
        sourceText: 'xin chào',
        targetText: 'Hello, how are you?',
        direction: 'vi_to_en',
      });

      const ended = await client.waitFor('server.session.ended');
      expect(ended.reason).toBe('completed');

      // The audio must survive the trip intact: frames are raw samples, so
      // concatenating them reproduces exactly what the TTS backend returned —
      // here twice over, once per clause.
      const audio = client.events
        .filter((e) => e.type === 'server.audio.frame')
        .map((e) => e.frame);
      expect(audio.length).toBeGreaterThan(1);
      expect(
        audio.every((f) => f.encoding === 'pcm16' && f.sampleRate === 24000),
      ).toBe(true);
      expect(
        Buffer.concat(
          audio.map((f) => Buffer.from(f.payload, 'base64')),
        ).equals(Buffer.concat([ttsPcm, ttsPcm])),
      ).toBe(true);
      expect(fakeProviders.tts.synthesize).toHaveBeenCalledTimes(2);
    } finally {
      client.close();
    }
  }, 20000);

  it('starts the text half early when the client suspects the end', async () => {
    fakeProviders.translation.translate.mockClear();
    const client = await Client.connect(url);
    try {
      client.send('client.session.start', {
        type: 'client.session.start',
        direction: 'vi_to_en',
      });
      const { sessionId } = await client.waitFor('server.session.ready');

      // An utterance is many frames, not one. A single frame would leave the
      // byte count trivially unchanged and prove nothing about a real turn.
      for (let sequence = 0; sequence < 12; sequence += 1) {
        client.send('client.audio.frame', frame(sessionId, sequence));
      }
      // Sending nothing further is what a real client does from here on, but
      // this test does not prove that it does — `CapturePump` is not in this
      // process. It covers the server's half only: given no further frames,
      // the guess is reused. The client's half is covered by
      // `apps/web/src/audio/capture-pump.spec.ts`.
      client.send('client.turn.speculate', { type: 'client.turn.speculate' });
      client.send('client.session.end', { type: 'client.session.end' });

      const ended = await client.waitFor('server.session.ended');
      expect(ended.reason).toBe('completed');
      // No further audio arrived after the guess, so the endpoint reused it
      // rather than translating the same utterance a second time.
      //
      // Counted on translation rather than transcription: the live transcript
      // re-reads the turn as it grows, so the number of times audio was
      // transcribed says nothing about whether the guess was reused. Only the
      // whole-turn path translates.
      expect(fakeProviders.translation.translate).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
    }
  }, 20000);

  it('reports a frame sent before the session was opened', async () => {
    const client = await Client.connect(url);
    try {
      client.send('client.audio.frame', frame('never-opened', 0));
      const error = await client.waitFor('server.error');
      expect(error.code).toBe('no_active_session');
    } finally {
      client.close();
    }
  }, 20000);
});
