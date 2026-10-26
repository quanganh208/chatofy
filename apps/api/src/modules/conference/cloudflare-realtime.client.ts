import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConferenceIceServer } from '@chatofy/types';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';

const API_BASE = 'https://rtc.live.cloudflare.com/v1';
/** Every SFU call is a short control request; a stuck one must not hold a session queue. */
const REQUEST_TIMEOUT_MS = 8000;
/** Cloudflare's `retryable_transient_error` is retried once, after this pause. */
const TRANSIENT_RETRY_DELAY_MS = 300;
const TRANSIENT_ERROR = 'retryable_transient_error';
/**
 * A mutation sent while an earlier SFU offer is still unanswered. Measured
 * against a real app: it cannot succeed on retry, and it means the caller
 * bypassed the per-session queue, so it is thrown as is.
 */
const STATUS_OUT_OF_ORDER = 406;

/**
 * A Cloudflare Realtime call that failed as a whole. The message carries only
 * the HTTP status and Cloudflare's `errorCode` — never the request, the SDP or
 * a credential — so it is safe to log.
 */
export class CloudflareRealtimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(
      `Cloudflare Realtime request failed: HTTP ${status} ${code ?? 'no_error_code'}`,
    );
    this.name = 'CloudflareRealtimeError';
  }
}

const errorBodySchema = z.object({ errorCode: z.string().optional() });
const sessionDescriptionSchema = z.object({
  type: z.string(),
  sdp: z.string(),
});
const trackResultSchema = z.object({
  mid: z.string().optional(),
  trackName: z.string().optional(),
  sessionId: z.string().optional(),
  errorCode: z.string().optional(),
});
const newSessionSchema = z.object({ sessionId: z.string().min(1) });
const tracksResponseSchema = z.object({
  sessionDescription: sessionDescriptionSchema.optional(),
  requiresImmediateRenegotiation: z.boolean().optional(),
  tracks: z.array(trackResultSchema).optional(),
});
const iceServersResponseSchema = z.object({
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});

export interface PushedTrack {
  mid: string;
  trackName: string;
  errorCode?: string;
}

export interface PulledTrack extends PushedTrack {
  /** The publisher's session the track was pulled from. */
  sessionId: string;
}

export interface PushResult {
  answerSdp: string;
  tracks: PushedTrack[];
}

export interface PullResult {
  /** The SFU's offer for the receiving connection, or null when none was made. */
  offerSdp: string | null;
  requiresImmediateRenegotiation: boolean;
  tracks: PulledTrack[];
}

/**
 * Thin client for the Cloudflare Realtime SFU Sessions/Tracks API and the
 * Realtime TURN credential endpoint. Calls are not serialized here: callers
 * hold a per-session queue, because the SFU rejects overlapping mutations.
 *
 * Constructed whenever the API boots — meetings always load — so a missing app
 * id or secret fails the boot rather than the first join.
 */
@Injectable()
export class CloudflareRealtimeClient {
  private readonly appBase: string;
  private readonly appSecret: string;
  private readonly turnKeyId: string | undefined;
  private readonly turnToken: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    const appId = config.get('CLOUDFLARE_REALTIME_APP_ID', { infer: true });
    const appSecret = config.get('CLOUDFLARE_REALTIME_APP_SECRET', {
      infer: true,
    });
    if (!appId || !appSecret) {
      throw new Error(
        'Meetings require CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_APP_SECRET',
      );
    }
    this.appBase = `${API_BASE}/apps/${encodeURIComponent(appId)}`;
    this.appSecret = appSecret;
    this.turnKeyId = config.get('CLOUDFLARE_TURN_KEY_ID', { infer: true });
    this.turnToken = config.get('CLOUDFLARE_TURN_KEY_API_TOKEN', {
      infer: true,
    });
  }

  async newSession(): Promise<string> {
    const body = await this.call('POST', this.sessionUrl('new'), undefined);
    return parse(newSessionSchema, body).sessionId;
  }

  /** Publish: hand the SFU the client's offer and get its answer back. */
  async pushTracks(
    sessionId: string,
    offerSdp: string,
    tracks: { mid: string; trackName: string }[],
  ): Promise<PushResult> {
    const body = await this.call(
      'POST',
      this.sessionUrl(sessionId, 'tracks/new'),
      {
        sessionDescription: { type: 'offer', sdp: offerSdp },
        tracks: tracks.map((t) => ({ location: 'local', ...t })),
      },
    );
    const parsed = parse(tracksResponseSchema, body);
    if (!parsed.sessionDescription) {
      throw new CloudflareRealtimeError(200, 'missing_session_description');
    }
    return {
      answerSdp: parsed.sessionDescription.sdp,
      tracks: (parsed.tracks ?? []).map(toPushedTrack),
    };
  }

  /** Subscribe: pull other sessions' tracks into this one; the SFU makes the offer. */
  async pullTracks(
    sessionId: string,
    remotes: { sessionId: string; trackName: string }[],
  ): Promise<PullResult> {
    const body = await this.call(
      'POST',
      this.sessionUrl(sessionId, 'tracks/new'),
      {
        tracks: remotes.map((r) => ({ location: 'remote', ...r })),
      },
    );
    const parsed = parse(tracksResponseSchema, body);
    return {
      offerSdp: parsed.sessionDescription?.sdp ?? null,
      requiresImmediateRenegotiation:
        parsed.requiresImmediateRenegotiation ?? false,
      tracks: (parsed.tracks ?? []).map((t) => ({
        ...toPushedTrack(t),
        sessionId: t.sessionId ?? '',
      })),
    };
  }

  /** Submit the client's answer to the SFU's last offer on this session. */
  async renegotiate(sessionId: string, answerSdp: string): Promise<void> {
    await this.call('PUT', this.sessionUrl(sessionId, 'renegotiate'), {
      sessionDescription: { type: 'answer', sdp: answerSdp },
    });
  }

  /**
   * Stop forwarding the given mids without an SDP round trip. A per-track
   * failure (already closed, backend hiccup) comes back as HTTP 200 and is
   * not an error here: the caller is tearing down and has nothing to retry.
   */
  async forceCloseTracks(sessionId: string, mids: string[]): Promise<void> {
    if (mids.length === 0) return;
    await this.call('PUT', this.sessionUrl(sessionId, 'tracks/close'), {
      tracks: mids.map((mid) => ({ mid })),
      force: true,
    });
  }

  /** Short-lived TURN credentials, or null when no TURN key is configured. */
  async generateIceServers(
    ttlSeconds: number,
  ): Promise<ConferenceIceServer[] | null> {
    if (!this.turnKeyId || !this.turnToken) return null;
    const url = `${API_BASE}/turn/keys/${encodeURIComponent(this.turnKeyId)}/credentials/generate-ice-servers`;
    const body = await this.call(
      'POST',
      url,
      { ttl: ttlSeconds },
      this.turnToken,
    );
    return parse(iceServersResponseSchema, body).iceServers;
  }

  private sessionUrl(...parts: string[]): string {
    const [first, ...rest] = parts;
    return [
      `${this.appBase}/sessions/${encodeURIComponent(first ?? '')}`,
      ...rest,
    ].join('/');
  }

  /** One request, with the single in-client retry for a transient error. */
  private async call(
    method: 'POST' | 'PUT',
    url: string,
    payload: unknown,
    token = this.appSecret,
  ): Promise<unknown> {
    try {
      return await this.send(method, url, payload, token);
    } catch (err) {
      const retryable =
        err instanceof CloudflareRealtimeError &&
        err.code === TRANSIENT_ERROR &&
        err.status !== STATUS_OUT_OF_ORDER;
      if (!retryable) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS),
      );
      return this.send(method, url, payload, token);
    }
  }

  private async send(
    method: 'POST' | 'PUT',
    url: string,
    payload: unknown,
    token: string,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // A network failure or the timeout. The underlying error is dropped: it
      // can echo the request, and the caller only needs to know it failed.
      throw new CloudflareRealtimeError(0, 'request_failed');
    }
    const body = await readJson(res);
    const code = errorBodySchema.safeParse(body).data?.errorCode;
    if (!res.ok || code) throw new CloudflareRealtimeError(res.status, code);
    return body;
  }
}

function toPushedTrack(t: z.infer<typeof trackResultSchema>): PushedTrack {
  return {
    mid: t.mid ?? '',
    trackName: t.trackName ?? '',
    ...(t.errorCode ? { errorCode: t.errorCode } : {}),
  };
}

/** The response body as JSON; an empty body is `{}`, a malformed one is `undefined`. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new CloudflareRealtimeError(200, 'unexpected_response');
  return parsed.data;
}
