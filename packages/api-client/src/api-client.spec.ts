import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './api-client.js';
import { ApiClientError, ContractError, NetworkError } from './errors.js';

const dataSchema = z.object({ value: z.string() });

function successBody(value: string) {
  return {
    success: true,
    data: { value },
    meta: { requestId: 'r1', timestamp: '2026-07-18T00:00:00Z' },
  };
}

function errorBody() {
  return {
    success: false,
    error: { code: 'VALIDATION_FAILED', message: 'nope' },
    meta: { requestId: 'r1', timestamp: '2026-07-18T00:00:00Z' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('createApiClient', () => {
  it('returns parsed data for a success envelope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(successBody('hi')));
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    await expect(apiFetch('/x', dataSchema)).resolves.toEqual({ value: 'hi' });
  });

  it('throws ApiClientError for an error envelope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(errorBody(), 400));
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    const err = await apiFetch('/x', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).error.code).toBe('VALIDATION_FAILED');
  });

  it('throws ContractError when the body does not match the contract', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ weird: true }));
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    await expect(apiFetch('/x', dataSchema)).rejects.toBeInstanceOf(ContractError);
  });

  it('keeps status-first semantics for a non-JSON 502 (proxy error page)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('not json')),
    } as unknown as Response);
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    const err = await apiFetch('/x', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(502);
  });

  it('wraps network failures in NetworkError with the cause preserved', async () => {
    const netErr = new TypeError('fetch failed');
    globalThis.fetch = vi.fn().mockRejectedValue(netErr);
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    const err = await apiFetch('/x', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(false);
    expect((err as NetworkError).cause).toBe(netErr);
  });

  it('maps a fetch abort to a timed-out NetworkError', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abort = new Error('The operation was aborted');
          abort.name = 'AbortError';
          reject(abort);
        });
      });
    });
    const { apiFetch } = createApiClient({ baseUrl: 'http://api', timeoutMs: 10 });
    const err = await apiFetch('/x', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });

  it('times out a slow body read, not just a slow fetch', async () => {
    // fetch resolves fast, but the body read hangs until the abort fires.
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      const res = {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const abort = new Error('The operation was aborted');
              abort.name = 'AbortError';
              reject(abort);
            });
          }),
      } as unknown as Response;
      return Promise.resolve(res);
    });
    const { apiFetch } = createApiClient({ baseUrl: 'http://api', timeoutMs: 10 });
    const err = await apiFetch('/x', dataSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });

  it('resolves undefined-able schemas on 204 No Content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new SyntaxError('no body')),
    } as unknown as Response);
    const { apiFetch } = createApiClient({ baseUrl: 'http://api' });
    await expect(apiFetch('/x', z.undefined())).resolves.toBeUndefined();
  });
});
