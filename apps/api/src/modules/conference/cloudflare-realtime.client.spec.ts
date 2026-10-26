import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Env } from '../../config/env.schema';
import {
  CloudflareRealtimeClient,
  CloudflareRealtimeError,
} from './cloudflare-realtime.client';

const APP_ID = 'app-123';
const SECRET = 'app-secret-never-in-a-message';

function makeClient(env: Partial<Env> = {}) {
  const values: Partial<Env> = {
    CLOUDFLARE_REALTIME_APP_ID: APP_ID,
    CLOUDFLARE_REALTIME_APP_SECRET: SECRET,
    ...env,
  };
  const config = {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
  return new CloudflareRealtimeClient(config);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

/** The `[url, init]` of one captured fetch call. */
function callOf(
  mock: MockInstance<typeof fetch>,
  index = 0,
): [string, RequestInit] {
  return mock.mock.calls[index] as [string, RequestInit];
}

describe('CloudflareRealtimeClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns the sessionId from a 201 on newSession', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(201, { sessionId: 'sess-1' }));

    await expect(makeClient().newSession()).resolves.toBe('sess-1');
    const [url, init] = callOf(fetchMock);
    expect(url).toBe(
      `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/new`,
    );
    expect(init.method).toBe('POST');
  });

  it('pushTracks sends the bearer header and the local track body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        requiresImmediateRenegotiation: false,
        tracks: [{ trackName: 'audio', mid: '0' }],
        sessionDescription: { type: 'answer', sdp: 'v=0 answer' },
      }),
    );

    const result = await makeClient().pushTracks('sess-1', 'v=0 offer', [
      { mid: '0', trackName: 'audio' },
    ]);

    expect(result).toStrictEqual({
      answerSdp: 'v=0 answer',
      tracks: [{ mid: '0', trackName: 'audio' }],
    });
    const [url, init] = callOf(fetchMock);
    expect(url).toMatch(/\/sessions\/sess-1\/tracks\/new$/);
    expect(new Headers(init.headers).get('Authorization')).toBe(
      `Bearer ${SECRET}`,
    );
    expect(JSON.parse(init.body as string)).toStrictEqual({
      sessionDescription: { type: 'offer', sdp: 'v=0 offer' },
      tracks: [{ location: 'local', mid: '0', trackName: 'audio' }],
    });
  });

  it('pullTracks maps the remote_tracks response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        requiresImmediateRenegotiation: true,
        tracks: [
          {
            sessionId: '2a45361d5fd7cc14eface0587c276c94',
            trackName: 'video',
            mid: '7',
          },
        ],
        sessionDescription: { type: 'offer', sdp: 'v=0 sfu offer' },
      }),
    );

    const result = await makeClient().pullTracks('sub-1', [
      { sessionId: '2a45361d5fd7cc14eface0587c276c94', trackName: 'video' },
    ]);

    expect(result).toStrictEqual({
      offerSdp: 'v=0 sfu offer',
      requiresImmediateRenegotiation: true,
      tracks: [
        {
          mid: '7',
          trackName: 'video',
          sessionId: '2a45361d5fd7cc14eface0587c276c94',
        },
      ],
    });
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).toStrictEqual({
      tracks: [
        {
          location: 'remote',
          sessionId: '2a45361d5fd7cc14eface0587c276c94',
          trackName: 'video',
        },
      ],
    });
  });

  it('throws a 406 after one call, and retries a transient error once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(406, {
        errorCode: 'invalid_session_description',
        errorDescription: 'renegotiation is expected',
      }),
    );
    const client = makeClient();

    const err = await client.pullTracks('sub-1', []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareRealtimeError);
    expect(err).toMatchObject({
      status: 406,
      code: 'invalid_session_description',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        json(503, { errorCode: 'retryable_transient_error' }),
      )
      .mockResolvedValueOnce(json(201, { sessionId: 'sess-2' }));
    const pending = client.newSession();
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toBe('sess-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a 410 for an expired session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(410, { errorCode: 'session_error' }),
    );

    await expect(
      makeClient().renegotiate('gone', 'v=0 answer'),
    ).rejects.toMatchObject({ status: 410, code: 'session_error' });
  });

  it('does not throw on a mixed force-close result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, {
        requiresImmediateRenegotiation: false,
        tracks: [
          { mid: '0' },
          { mid: '1', errorCode: 'close_track_error' },
          { mid: '2', errorCode: 'internal_error' },
        ],
      }),
    );

    await expect(
      makeClient().forceCloseTracks('sess-1', ['0', '1', '2']),
    ).resolves.toBeUndefined();
    const [url, init] = callOf(fetchMock);
    expect(url).toMatch(/\/sessions\/sess-1\/tracks\/close$/);
    expect(JSON.parse(init.body as string)).toStrictEqual({
      tracks: [{ mid: '0' }, { mid: '1' }, { mid: '2' }],
      force: true,
    });
  });

  it('generateIceServers returns null without the TURN vars', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(makeClient().generateIceServers(3600)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to construct without the app secret', () => {
    expect(() =>
      makeClient({ CLOUDFLARE_REALTIME_APP_SECRET: undefined }),
    ).toThrow(
      'CONFERENCE_ENABLED requires CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_APP_SECRET',
    );
  });

  it('never puts the secret in an error message', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { errorCode: 'unauthorized' }))
      .mockRejectedValueOnce(new Error(`network down for Bearer ${SECRET}`));
    const client = makeClient();

    for (const attempt of [client.newSession(), client.newSession()]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CloudflareRealtimeError);
      expect(String(err)).not.toContain(SECRET);
      expect((err as Error).stack ?? '').not.toContain(SECRET);
    }
  });
});
