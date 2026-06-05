import type { z } from 'zod';
import { apiResponseSchema, type ApiResponse } from '@chatofy/types';
import { ApiClientError, ContractError } from './errors.js';

/**
 * Minimal request options — deliberately NOT the DOM `RequestInit` type, so the
 * emitted declarations stay resolvable from React Native's bundler.
 */
export interface ApiRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Per-request abort timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Resolves auth/correlation headers per request (e.g. bearer token). */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Creates an API client bound to a base URL. The returned `apiFetch` is the
 * single response-parse boundary shared by web + mobile: it validates every
 * response against the shared envelope contract and returns typed data, or
 * throws ApiClientError (API said no) / ContractError (API drifted).
 */
export function createApiClient(config: ApiClientConfig) {
  if (!config.baseUrl) throw new Error('api-client: baseUrl is required');

  // Memoize the enveloped schema per data schema — apiResponseSchema builds a
  // fresh discriminatedUnion each call, so never rebuild it per request.
  const envelopeCache = new WeakMap<z.ZodType, z.ZodType>();
  const envelopeFor = (dataSchema: z.ZodType): z.ZodType => {
    const cached = envelopeCache.get(dataSchema);
    if (cached) return cached;
    const built: z.ZodType = apiResponseSchema(dataSchema);
    envelopeCache.set(dataSchema, built);
    return built;
  };

  async function apiFetch<T extends z.ZodType>(
    path: string,
    dataSchema: T,
    init?: ApiRequestOptions,
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await globalThis.fetch(`${config.baseUrl}${path}`, {
        method: init?.method,
        body: init?.body,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(config.getHeaders ? await config.getHeaders() : {}),
          ...init?.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // 204 / empty success — allow void/undefined-able data schemas.
    if (res.status === 204) {
      const empty = dataSchema.safeParse(undefined);
      if (empty.success) return empty.data as z.infer<T>;
    }

    const json: unknown = await res.json().catch(() => null);

    // Status-first: a non-JSON / proxy error (502 HTML, gateway timeout) must
    // surface the real status, never a misleading ContractError.
    if (json === null) {
      if (!res.ok) {
        throw new ApiClientError(
          { code: 'INTERNAL_ERROR', message: `HTTP ${res.status}` },
          res.status,
        );
      }
      throw new ContractError('Empty or non-JSON response body', null);
    }

    const parsed = envelopeFor(dataSchema).safeParse(json);
    if (!parsed.success) throw new ContractError(parsed.error.issues, json);

    const envelope = parsed.data as ApiResponse<z.infer<T>>;
    if (!envelope.success) throw new ApiClientError(envelope.error, res.status);
    return envelope.data;
  }

  return { apiFetch };
}
