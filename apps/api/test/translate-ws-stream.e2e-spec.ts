import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import type { ServerEvent } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
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
  let identity: Identity;
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

  /** A backend stream of `pcm`, cut where a network would cut it: mid-sample. */
  const streamOf = (pcm: Buffer) => ({
    encoding: 'pcm16' as const,
    sampleRate: 24000,
    chunks: (async function* () {
      for (let at = 0; at < pcm.length; at += 4001) {
        yield new Uint8Array(pcm.subarray(at, at + 4001));
      }
    })(),
  });

  const fakeProviders: {
    stt: { name: string; transcribe: ReturnType<typeof vi.fn> };
    translation: { name: string; translate: ReturnType<typeof vi.fn> };
    tts: {
      name: string;
      outputMimeType: string;
      synthesize: ReturnType<typeof vi.fn>;
      /** Absent unless a test installs it: the clause path is the default here. */
      synthesizeStream?: ReturnType<typeof vi.fn>;
    };
  } = {
    stt: {
      name: 'fake-stt',
      transcribe: vi
        .fn()
        .mockResolvedValue({ text: 'xin chào', language: 'vi' }),
    },
    translation: {
      name: 'fake-translation',
      // Two clauses, so the streaming path's per-clause synthesis is exercised
      // rather than the degenerate single-part case.
      translate: vi.fn().mockResolvedValue({ text: 'Hello, how are you?' }),
    },
    tts: {
      name: 'fake-tts',
      outputMimeType: 'audio/wav',
      synthesize: vi.fn().mockResolvedValue(new Uint8Array(ttsWav)),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => fakeProviders })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    // A real port: the point of this suite is to speak the actual protocol.
    await app.listen(0);
    identity = await registerAndLogin(app);
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

    static async connect(
      target: string,
      // Defaulted, so the fourteen existing call sites stay unchanged and the
      // auth cases can still offer a deliberately wrong handshake.
      protocols: string[] = identity.subprotocols,
    ): Promise<Client> {
      const socket = new WebSocket(target, protocols);
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
        turnId: 'turn-1',
      });
      const ready = await client.waitFor('server.session.ready');
      const sessionId = ready.sessionId;
      expect(sessionId).toEqual(expect.any(String));
      // The client's own name comes back, which is what lets a client with
      // several turns in flight match this answer to the start that asked for it.
      expect(ready.turnId).toBe('turn-1');

      client.send('client.audio.frame', frame(sessionId, 0));
      client.send('client.audio.frame', frame(sessionId, 1));
      client.send('client.session.end', {
        type: 'client.session.end',
        sessionId,
      });

      const transcript = await client.waitFor('server.transcript.final');
      expect(transcript.segment).toMatchObject({
        sessionId,
        sourceText: 'xin chào',
        targetText: 'Hello, how are you?',
        direction: 'vi_to_en',
      });

      const ended = await client.waitFor('server.session.ended');
      expect(ended.reason).toBe('completed');
      // Both names travel on the ending too. `turnId` is the one that matters
      // for a turn the client never saw a `ready` for.
      expect(ended.sessionId).toBe(sessionId);
      expect(ended.turnId).toBe('turn-1');

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

  /** Drive one turn over the socket and collect what came back. */
  async function runTurn(turnId: string) {
    const client = await Client.connect(url);
    try {
      client.send('client.session.start', {
        type: 'client.session.start',
        direction: 'vi_to_en',
        turnId,
      });
      const { sessionId } = await client.waitFor('server.session.ready');
      client.send('client.audio.frame', frame(sessionId, 0));
      client.send('client.audio.frame', frame(sessionId, 1));
      client.send('client.session.end', {
        type: 'client.session.end',
        sessionId,
      });
      const ended = await client.waitFor('server.session.ended');
      const audio = client.events
        .filter((e) => e.type === 'server.audio.frame')
        .map((e) => e.frame);
      return { ended, audio };
    } finally {
      client.close();
    }
  }

  it('streams a whole turn from a backend that can stream', async () => {
    fakeProviders.tts.synthesize.mockClear();
    fakeProviders.tts.synthesizeStream = vi
      .fn()
      .mockImplementation(() => Promise.resolve(streamOf(ttsPcm)));
    try {
      const { ended, audio } = await runTurn('turn-stream');

      expect(ended.reason).toBe('completed');
      // One request for the whole turn, not one per clause.
      expect(fakeProviders.tts.synthesizeStream).toHaveBeenCalledTimes(1);
      expect(fakeProviders.tts.synthesize).not.toHaveBeenCalled();
      // Cut mid-sample on the way in, intact on the way out.
      expect(
        audio.every((f) => f.encoding === 'pcm16' && f.sampleRate === 24000),
      ).toBe(true);
      expect(
        Buffer.concat(
          audio.map((f) => Buffer.from(f.payload, 'base64')),
        ).equals(ttsPcm),
      ).toBe(true);
    } finally {
      delete fakeProviders.tts.synthesizeStream;
    }
  }, 20000);

  it('falls back to clauses when the sidecar has no stream endpoint', async () => {
    fakeProviders.tts.synthesize.mockClear();
    // What the local provider answers for a 404 from an older sidecar.
    fakeProviders.tts.synthesizeStream = vi.fn().mockResolvedValue(null);
    try {
      const { ended } = await runTurn('turn-fallback');

      expect(ended.reason).toBe('completed');
      expect(fakeProviders.tts.synthesize).toHaveBeenCalledTimes(2);
    } finally {
      delete fakeProviders.tts.synthesizeStream;
    }
  }, 20000);

  it('starts the text half early when the client suspects the end', async () => {
    fakeProviders.translation.translate.mockClear();
    const client = await Client.connect(url);
    try {
      client.send('client.session.start', {
        type: 'client.session.start',
        direction: 'vi_to_en',
        turnId: 'turn-2',
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
      // `packages/realtime-client/src/audio/capture-pump.spec.ts`.
      client.send('client.turn.speculate', {
        type: 'client.turn.speculate',
        sessionId,
      });
      client.send('client.session.end', {
        type: 'client.session.end',
        sessionId,
      });

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
