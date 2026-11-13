import { defaultUserPreferences } from '@chatofy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferencesTransport, PreferencesRequestError } from './preferences-transport';

const BASE = 'http://api.test';
const store = new Map<string, unknown>();

vi.mock('./access-token', () => ({
  getFreshAccessToken: vi.fn(() => Promise.resolve('renewed')),
}));

beforeEach(() => {
  store.clear();
  store.set('chatofy.accessToken', 'stored');
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
      },
    },
  };
});

const body = { preferences: defaultUserPreferences('en'), updatedAt: null };
const ok = (data: unknown = body) =>
  new Response(JSON.stringify({ success: true, data, meta: { requestId: 'r', timestamp: 't' } }), {
    status: 200,
  });

describe('preferences transport', () => {
  it('GETs /me/preferences with the stored bearer and parses the envelope', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));
    const result = await createPreferencesTransport(BASE, fetchImpl).load();
    expect(result.updatedAt).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/me/preferences`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored' });
  });

  it('PATCHes the patch wrapped in { preferences }, and DELETEs for reset', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok()));
    const transport = createPreferencesTransport(BASE, fetchImpl);
    await transport.save({ theme: 'dark' });
    await transport.reset();
    const [, patchInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(patchInit.method).toBe('PATCH');
    expect(JSON.parse(patchInit.body as string)).toEqual({ preferences: { theme: 'dark' } });
    const [, resetInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(resetInit.method).toBe('DELETE');
  });

  it('retries once with a renewed token after a 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(ok());
    await createPreferencesTransport(BASE, fetchImpl as never).load();
    const [, retry] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(retry.headers).toMatchObject({ authorization: 'Bearer renewed' });
  });

  it('carries the HTTP status on the error', async () => {
    const refused = vi.fn(() => Promise.resolve(new Response('{}', { status: 422 })));
    await expect(createPreferencesTransport(BASE, refused as never).save({})).rejects.toMatchObject(
      { status: 422 },
    );
  });

  it('throws when signed out, on an HTTP failure and on an unreadable body', async () => {
    const fail = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })));
    await expect(createPreferencesTransport(BASE, fail as never).load()).rejects.toBeInstanceOf(
      PreferencesRequestError,
    );
    const junk = vi.fn(() => Promise.resolve(ok({ preferences: 'nope' })));
    await expect(createPreferencesTransport(BASE, junk as never).load()).rejects.toThrow(
      /Unreadable/,
    );
    store.delete('chatofy.accessToken');
    await expect(createPreferencesTransport(BASE, fail as never).load()).rejects.toThrow(
      /Not signed in/,
    );
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
