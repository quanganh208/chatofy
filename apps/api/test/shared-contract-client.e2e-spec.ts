import { z } from 'zod';
import { apiResponseSchema, serviceDescriptorSchema } from '@chatofy/types';
import {
  ApiClientError,
  ContractError,
  createApiClient,
} from '@chatofy/api-client';

/**
 * Cross-package contract test: proves the shared envelope schema (@chatofy/types)
 * and the @chatofy/api-client parse boundary agree end-to-end. Lives in the api's
 * jest suite (api-client is a devDependency) so the repo keeps a single test
 * runner. Also exercises the dual-build CJS path (jest is CommonJS) and the
 * runtime drift guarantee.
 */
const meta = { requestId: 'r', timestamp: 't' };

/** A valid GET / payload — the descriptor is this suite's contract fixture. */
const descriptor = {
  name: 'chatofy-api',
  version: '0.0.1',
  description: 'Real-time voice translation API',
  status: 'ok' as const,
};

describe('apiResponseSchema factory', () => {
  const schema = apiResponseSchema(z.object({ x: z.string() }));

  it('parses the success branch', () => {
    expect(
      schema.safeParse({ success: true, data: { x: 'y' }, meta }).success,
    ).toBe(true);
  });

  it('parses the error branch', () => {
    expect(
      schema.safeParse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'nope' },
        meta,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed body', () => {
    expect(schema.safeParse({ foo: 'bar' }).success).toBe(false);
  });
});

describe('api-client apiFetch', () => {
  const api = createApiClient({ baseUrl: 'http://test' });

  const mockResponse = (status: number, body: unknown, jsonThrows = false) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status,
      ok: status >= 200 && status < 300,
      json: jsonThrows
        ? () => Promise.reject(new Error('not json'))
        : () => Promise.resolve(body),
    } as Response);
  };

  afterEach(() => jest.restoreAllMocks());

  it('returns validated data on a success envelope', async () => {
    mockResponse(200, { success: true, data: descriptor, meta });
    await expect(api.apiFetch('/', serviceDescriptorSchema)).resolves.toEqual(
      descriptor,
    );
  });

  it('throws ApiClientError on an error envelope', async () => {
    mockResponse(409, {
      success: false,
      error: { code: 'CONFLICT', message: 'dupe' },
      meta,
    });
    await expect(
      api.apiFetch('/', serviceDescriptorSchema),
    ).rejects.toMatchObject({ name: 'ApiClientError', status: 409 });
  });

  it('throws ContractError when the envelope shape drifts', async () => {
    mockResponse(200, { foo: 'bar' });
    await expect(
      api.apiFetch('/', serviceDescriptorSchema),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it('throws ContractError when the data shape drifts', async () => {
    // `status` is a literal 'ok' in the contract — a different value is drift.
    mockResponse(200, {
      success: true,
      data: { ...descriptor, status: 'degraded' },
      meta,
    });
    await expect(
      api.apiFetch('/', serviceDescriptorSchema),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it('surfaces real status (ApiClientError) on a non-JSON 5xx, not ContractError', async () => {
    mockResponse(502, null, true);
    await expect(
      api.apiFetch('/', serviceDescriptorSchema),
    ).rejects.toMatchObject({ name: 'ApiClientError', status: 502 });
  });

  it('resolves a 204 against a void-able data schema', async () => {
    mockResponse(204, null, true);
    await expect(api.apiFetch('/logout', z.void())).resolves.toBeUndefined();
  });

  it('throws if baseUrl is missing', () => {
    expect(() => createApiClient({ baseUrl: '' })).toThrow();
  });

  it('exposes ApiClientError with status', () => {
    expect(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: 'x' }, 500).status,
    ).toBe(500);
  });
});
