import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConnectionError } from '../errors/provider-errors.js';
import { fetchWithDeadline } from './http-util.js';

/**
 * The deadline is the whole point of `fetchWithDeadline` — every provider call
 * goes through it precisely so a wedged sidecar cannot pin a turn slot
 * forever. Proving that needs a fetch that never answers. The budget is real
 * and small rather than faked: `AbortSignal.timeout` schedules on a timer the
 * test framework's clock cannot intercept, so the spec spends ~100ms of real
 * time instead of pretending to spend 5s.
 */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/**
 * A server that accepts the connection and never answers — modelled on the
 * REAL fetch contract, not a bare never-settling promise. Only the real fetch
 * rejects when its signal fires; a promise that simply never settles would
 * ignore the abort entirely and the deadline would never surface. Rejecting on
 * abort with a `TimeoutError` is exactly what Node's fetch does.
 */
const hangingFetch = () =>
  vi.fn().mockImplementation(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('signal timed out', 'TimeoutError'));
        });
      }),
  );

describe('fetchWithDeadline', () => {
  it('rejects with ProviderConnectionError when the deadline passes', async () => {
    globalThis.fetch = hangingFetch();

    await expect(
      fetchWithDeadline('http://sidecar/transcribe', { method: 'POST' }, 50, 'Local STT request'),
    ).rejects.toBeInstanceOf(ProviderConnectionError);
  });

  it('names the timeout and the budget in the error', async () => {
    globalThis.fetch = hangingFetch();

    await expect(
      fetchWithDeadline('http://sidecar/embed', {}, 50, 'Local embed request'),
    ).rejects.toThrow('Local embed request timed out after 50ms');
  });

  it('reports a connection refusal as a failure, not a timeout', async () => {
    // ECONNREFUSED and friends reject immediately; the error must not claim a
    // timeout, or an operator reads it as "sidecar too slow" when the truth is
    // "sidecar not running".
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      fetchWithDeadline('http://sidecar/transcribe', {}, 5_000, 'Local STT request'),
    ).rejects.toThrow('Local STT request failed');
  });

  it('passes the response through untouched inside the budget', async () => {
    const response = new Response('{}', { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(response);

    await expect(
      fetchWithDeadline('http://sidecar/voices', {}, 5_000, 'Local TTS voice catalog request'),
    ).resolves.toBe(response);
  });
});
