import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '@chatofy/ai-providers';
import type {
  RealtimeProvider,
  RealtimeStartParams,
  RealtimeStreamEvents,
  StreamHandle,
} from '@chatofy/ai-providers';
import type { LiveServerEvent } from '@chatofy/types';
import { LiveTranslateSessionService } from './live-translate-session.service';
import type { LiveSessionMetrics } from '../services/live-session-metrics.recorder';
import type { LiveSessionMetricsRecorder } from '../services/live-session-metrics.recorder';
import type { StreamSocket } from './stream-socket';
import {
  MAX_CONCURRENT_TURNS_GLOBAL,
  TURN_IDLE_TIMEOUT_MS,
} from './turn-concurrency';
import { MAX_LIVE_SESSION_INPUT_BYTES } from './live-session-limits';

/** A socket that records what the server sent it. */
class FakeSocket implements StreamSocket {
  readonly sent: LiveServerEvent[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as LiveServerEvent);
  }
  events(type: LiveServerEvent['type']): LiveServerEvent[] {
    return this.sent.filter((e) => e.type === type);
  }
}

/** One upstream session, and everything done to it. */
interface FakeUpstream {
  handle: StreamHandle;
  events: RealtimeStreamEvents;
  params: RealtimeStartParams;
  closes: number;
  pushed: number;
}

/**
 * A provider whose dial can be held open.
 *
 * `resolveNext` matters: the defects this suite exists for all live in the
 * window between reserving a session and the upstream answering, and a provider
 * that resolves immediately closes that window before a test can look into it.
 */
class FakeProvider implements RealtimeProvider {
  readonly name = 'fake-realtime';
  readonly upstreams: FakeUpstream[] = [];
  /** Pending dials, released by `resolveAll()`. */
  private pending: (() => void)[] = [];
  private manual = false;

  holdDials(): void {
    this.manual = true;
  }

  resolveAll(): void {
    const waiting = this.pending;
    this.pending = [];
    for (const release of waiting) release();
  }

  start(
    params: RealtimeStartParams,
    events: RealtimeStreamEvents,
  ): Promise<StreamHandle> {
    const index = this.upstreams.length;
    const upstream: FakeUpstream = {
      handle: {
        id: `fake-${index}`,
        close: () => {
          upstream.closes += 1;
          return Promise.resolve();
        },
      },
      events,
      params,
      closes: 0,
      pushed: 0,
    };
    this.upstreams.push(upstream);
    if (!this.manual) return Promise.resolve(upstream.handle);
    return new Promise((resolve) =>
      this.pending.push(() => resolve(upstream.handle)),
    );
  }

  pushAudio(handle: StreamHandle, chunk: Uint8Array): Promise<void> {
    const upstream = this.upstreams.find((u) => u.handle.id === handle.id);
    if (upstream) upstream.pushed += chunk.length;
    return Promise.resolve();
  }
}

/** 100 ms of 16 kHz mono pcm16 — the shape the client actually captures. */
function frame(bytes = 3200) {
  return {
    sessionId: 'client-supplied',
    encoding: 'pcm16' as const,
    sampleRate: 16000,
    sequence: 0,
    timestamp: 0,
    payload: Buffer.alloc(bytes).toString('base64'),
  };
}

describe('LiveTranslateSessionService', () => {
  let provider: FakeProvider;
  let rows: LiveSessionMetrics[];
  let service: LiveTranslateSessionService;

  beforeEach(() => {
    provider = new FakeProvider();
    rows = [];
    const registry = new ProviderRegistry();
    registry.register('realtime', {
      name: 'gemini-live',
      create: () => provider,
    });
    const config = {
      get: () => 'test-key',
    } as unknown as ConfigService<Record<string, unknown>, true>;
    const metrics = {
      record: (row: LiveSessionMetrics) => rows.push(row),
    } as unknown as LiveSessionMetricsRecorder;

    service = new LiveTranslateSessionService(config, registry, metrics);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('starting', () => {
    it('opens the upstream with the direction and format the backend needs', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'en_to_vi');

      expect(provider.upstreams[0]!.params).toMatchObject({
        sourceLanguage: 'en',
        targetLanguage: 'vi',
        audioFormat: { encoding: 'pcm16', sampleRate: 16000, channels: 1 },
      });
      expect(socket.events('server.live.ready')).toHaveLength(1);
    });

    /**
     * The realtime backend is resolved by being the ONLY one registered, not by
     * name — so "how many are registered" is now a real invariant rather than a
     * detail. Both ways of breaking it must refuse loudly, because the failure
     * they guard against is a live arm silently translating through a backend
     * nobody chose, which corrupts a measurement instead of breaking a build.
     */
    it.each([
      ['none registered', [] as string[]],
      ['several registered', ['gemini-live', 'someone-elses-realtime']],
    ])('refuses to start when %s', async (_label, names) => {
      const registry = new ProviderRegistry();
      for (const name of names) {
        registry.register('realtime', { name, create: () => provider });
      }
      const isolated = new LiveTranslateSessionService(
        {
          get: () => 'test-key',
        } as unknown as ConfigService<Record<string, unknown>, true>,
        registry,
        { record: () => undefined } as unknown as LiveSessionMetricsRecorder,
      );
      const socket = new FakeSocket();

      await isolated.start(socket, 'vi_to_en');

      expect(provider.upstreams).toHaveLength(0);
      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'provider_unavailable',
      });
      await isolated.onModuleDestroy();
    });

    it('refuses a second session on the same connection', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      await service.start(socket, 'vi_to_en');

      expect(provider.upstreams).toHaveLength(1);
      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'session_exists',
      });
    });

    /**
     * The bug this reserves the slot for. The adapter does not serialize
     * handlers, so with registration on the far side of the dial every one of
     * these passed the guard and every overwritten handle became an upstream
     * socket no close path could reach.
     */
    it('refuses concurrent starts on one connection rather than leaking upstreams', async () => {
      provider.holdDials();
      const socket = new FakeSocket();

      const starts = [
        service.start(socket, 'vi_to_en'),
        service.start(socket, 'vi_to_en'),
        service.start(socket, 'vi_to_en'),
      ];
      provider.resolveAll();
      await Promise.all(starts);

      expect(provider.upstreams).toHaveLength(1);
      expect(service.openCount).toBe(1);
    });

    /** Same race, seen from the ceiling's point of view: 50 sockets, limit 6. */
    it('holds the global ceiling under a concurrent burst', async () => {
      provider.holdDials();
      const sockets = Array.from({ length: 50 }, () => new FakeSocket());

      const starts = sockets.map((socket) => service.start(socket, 'vi_to_en'));
      provider.resolveAll();
      await Promise.all(starts);

      expect(provider.upstreams.length).toBeLessThanOrEqual(
        MAX_CONCURRENT_TURNS_GLOBAL,
      );
      expect(service.openCount).toBe(MAX_CONCURRENT_TURNS_GLOBAL);
      expect(
        sockets.filter((s) => s.events('server.live.error').length > 0),
      ).toHaveLength(50 - MAX_CONCURRENT_TURNS_GLOBAL);
    });

    it('releases the reserved slot when the dial fails', async () => {
      const failing = new ProviderRegistry();
      failing.register('realtime', {
        name: 'gemini-live',
        create: () => ({
          name: 'boom',
          start: () => Promise.reject(new Error('bad key')),
          pushAudio: () => Promise.resolve(),
        }),
      });
      const failed = new LiveTranslateSessionService(
        { get: () => 'gemini-live' } as unknown as ConfigService<
          Record<string, unknown>,
          true
        >,
        failing,
        { record: () => undefined } as unknown as LiveSessionMetricsRecorder,
      );
      const socket = new FakeSocket();
      await failed.start(socket, 'vi_to_en');

      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'upstream_unavailable',
      });
      expect(failed.openCount).toBe(0);
      await failed.onModuleDestroy();
    });

    /**
     * The upstream can hang up the instant it opens — a rejected key arrives
     * that way. Without the post-dial check the client was told `ready` while
     * the socket was already dead, and no row was ever written.
     */
    it('closes the handle and writes one row when the session ends mid-dial', async () => {
      provider.holdDials();
      const socket = new FakeSocket();
      const starting = service.start(socket, 'vi_to_en');

      await service.stop(socket, 'client_stopped');
      provider.resolveAll();
      await starting;

      expect(provider.upstreams[0]!.closes).toBe(1);
      expect(rows).toHaveLength(1);
      expect(socket.events('server.live.ready')).toHaveLength(0);
      expect(socket.events('server.live.ended')).toHaveLength(1);
    });
  });

  describe('audio', () => {
    it('forwards every frame, including silent ones', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      for (let i = 0; i < 5; i += 1) await service.pushFrame(socket, frame());

      // Silence is how a model with no endpoint event learns the speaker
      // stopped. Withholding it truncates the translation.
      expect(provider.upstreams[0]!.pushed).toBe(3200 * 5);
    });

    it('refuses audio before a session exists', async () => {
      const socket = new FakeSocket();
      await service.pushFrame(socket, frame());
      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'no_live_session',
      });
    });

    it('refuses audio while the upstream is still dialing', async () => {
      provider.holdDials();
      const socket = new FakeSocket();
      const starting = service.start(socket, 'vi_to_en');

      await service.pushFrame(socket, frame());
      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'session_starting',
      });

      provider.resolveAll();
      await starting;
    });

    it('refuses a rate the backend does not take', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      await service.pushFrame(socket, { ...frame(), sampleRate: 48000 });

      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'unsupported_audio',
      });
      expect(provider.upstreams[0]!.pushed).toBe(0);
    });

    it('closes a session that exceeds its audio ceiling', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');

      const big = MAX_LIVE_SESSION_INPUT_BYTES + 1;
      await service.pushFrame(socket, frame(48000));
      // Drive past the ceiling without allocating it all at once.
      for (let sent = 48000; sent <= big; sent += 48000) {
        if (service.openCount === 0) break;
        await service.pushFrame(socket, frame(48000));
      }

      expect(service.openCount).toBe(0);
      expect(rows.at(-1)?.reason).toBe('too_much_audio');
    });
  });

  describe('closing', () => {
    it.each([
      [
        'client stop',
        async (s: FakeSocket) => service.stop(s, 'client_stopped'),
      ],
      ['shutdown', async () => service.onModuleDestroy()],
    ])('writes exactly one row on %s', async (_label, close) => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      await close(socket);

      expect(rows).toHaveLength(1);
      expect(provider.upstreams[0]!.closes).toBe(1);
    });

    /** Both paths race on a client that stops and immediately drops. */
    it('writes one row when two close paths race', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');

      await Promise.all([
        service.stop(socket, 'client_stopped'),
        service.stop(socket, 'disconnected'),
      ]);

      expect(rows).toHaveLength(1);
      expect(provider.upstreams[0]!.closes).toBe(1);
    });

    it('writes one row when the upstream hangs up', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');

      provider.upstreams[0]!.events.onClose?.('token expired');
      await Promise.resolve();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe('token expired');
      expect(socket.events('server.live.ended')).toHaveLength(1);
    });

    it('counts detected languages that disagree with the direction', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      const { events } = provider.upstreams[0]!;

      events.onSourceTranscript?.('xin chào', 'vi');
      events.onSourceTranscript?.('hello', 'en');
      events.onSourceTranscript?.('bonjour', 'en');
      await service.stop(socket, 'client_stopped');

      // Counted, not corrected — the column is what turns the docs' warning
      // about auto-detection into a measurement.
      expect(rows[0]!.languageMismatches).toBe(2);
    });

    it('reports output duration at the rate the backend used', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');

      // 24000 bytes of 24 kHz mono pcm16 = 500 ms.
      provider.upstreams[0]!.events.onTranslatedAudio?.(
        new Uint8Array(24000),
        24000,
      );
      await service.stop(socket, 'client_stopped');

      expect(rows[0]!.outputAudioMs).toBe(500);
    });
  });

  describe('idle sweep', () => {
    /**
     * The global ceiling needs this. Without it, six connections that start a
     * session and then say nothing hold a metered upstream socket each, for as
     * long as they stay connected, on an endpoint that takes no authentication.
     */
    it('closes a session that has gone quiet', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');

      expect(await service.sweepIdleSessions(Date.now())).toBe(0);
      const closed = await service.sweepIdleSessions(
        Date.now() + TURN_IDLE_TIMEOUT_MS + 1,
      );

      expect(closed).toBe(1);
      expect(provider.upstreams[0]!.closes).toBe(1);
      expect(rows[0]!.reason).toBe('idle_timeout');
      expect(socket.events('server.live.error')[0]).toMatchObject({
        code: 'session_abandoned',
      });
    });

    it('leaves a session that is still sending audio alone', async () => {
      const socket = new FakeSocket();
      await service.start(socket, 'vi_to_en');
      await service.pushFrame(socket, frame());

      expect(
        await service.sweepIdleSessions(Date.now() + TURN_IDLE_TIMEOUT_MS - 1),
      ).toBe(0);
      expect(service.openCount).toBe(1);
    });

    /** A dialing session has sent no frame by definition; sweeping it races the dial. */
    it('leaves a session that is still dialing alone', async () => {
      provider.holdDials();
      const socket = new FakeSocket();
      const starting = service.start(socket, 'vi_to_en');

      expect(
        await service.sweepIdleSessions(Date.now() + TURN_IDLE_TIMEOUT_MS + 1),
      ).toBe(0);

      provider.resolveAll();
      await starting;
    });
  });

  describe('key rotation', () => {
    /**
     * The only thing that reaches `RealtimeStartParams.apiKey`. The server opens
     * sessions on this path, so a harness driving the socket cannot choose a key
     * itself — without this the pool is configured and never walked.
     */
    function serviceWithKeys(keys: string) {
      const registry = new ProviderRegistry();
      registry.register('realtime', {
        name: 'gemini-live',
        create: () => provider,
      });
      return new LiveTranslateSessionService(
        {
          get: () => keys,
        } as unknown as ConfigService<Record<string, unknown>, true>,
        registry,
        { record: () => undefined } as unknown as LiveSessionMetricsRecorder,
      );
    }

    it('walks the pool one key per session', async () => {
      const svc = serviceWithKeys('k1,k2,k3');
      for (let i = 0; i < 4; i += 1) {
        const socket = new FakeSocket();
        await svc.start(socket, 'vi_to_en');
        await svc.stop(socket, 'client_stopped');
      }
      expect(provider.upstreams.map((u) => u.params.apiKey)).toEqual([
        'k1',
        'k2',
        'k3',
        'k1',
      ]);
      await svc.onModuleDestroy();
    });

    it('leaves the key unset when only one is configured', async () => {
      const svc = serviceWithKeys('solo');
      const socket = new FakeSocket();
      await svc.start(socket, 'vi_to_en');
      // Rotating over one key is that key; passing it explicitly would only add
      // a way for the service and the provider to disagree about it.
      expect(provider.upstreams[0]!.params.apiKey).toBeUndefined();
      await svc.onModuleDestroy();
    });

    it('ignores blank entries from a trailing comma', async () => {
      const svc = serviceWithKeys('k1, ,k2,');
      for (let i = 0; i < 2; i += 1) {
        const socket = new FakeSocket();
        await svc.start(socket, 'vi_to_en');
        await svc.stop(socket, 'client_stopped');
      }
      expect(provider.upstreams.map((u) => u.params.apiKey)).toEqual([
        'k1',
        'k2',
      ]);
      await svc.onModuleDestroy();
    });
  });
});
