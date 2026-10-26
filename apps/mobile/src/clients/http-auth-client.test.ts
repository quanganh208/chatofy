import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignedOutError, type AuthSession } from './auth-client.interface.ts';
import {
  AuthRequestError,
  HttpAuthClient,
  REFRESH_SKEW_MS,
  type SessionStore,
} from './http-auth-client.ts';

const NOW = Date.parse('2026-10-26T03:00:00Z');
const BASE = 'http://api.test';

function session(
  accessToken: string,
  expiresInMs: number,
  refreshToken = 'refresh-1',
): AuthSession {
  return {
    user: {
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      createdAt: '2026-01-01T00:00:00Z',
      locale: 'vi',
      avatarUrl: null,
    },
    token: { accessToken, refreshToken, expiresAt: new Date(NOW + expiresInMs).toISOString() },
  };
}

class MemoryStore implements SessionStore {
  value: AuthSession | null;
  constructor(initial: AuthSession | null = null) {
    this.value = initial;
  }
  async load() {
    return this.value;
  }
  async save(s: AuthSession) {
    this.value = s;
  }
  async clear() {
    this.value = null;
  }
}

function envelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: { requestId: 'r1', timestamp: new Date(NOW).toISOString() },
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

/** A fetch that records each call and answers from a per-route queue. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: { route: string; body: unknown }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const route = String(url).slice(BASE.length);
    calls.push({ route, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = routes[route];
    if (!answer) throw new Error(`unexpected ${route}`);
    return answer();
  }) as typeof fetch;
  return { impl, calls };
}

function client(store: SessionStore, fetchImpl: typeof fetch) {
  return new HttpAuthClient({ baseUrl: BASE, store, fetch: fetchImpl, now: () => NOW });
}

describe('HttpAuthClient', () => {
  it('signs in, stores the session and tells listeners', async () => {
    const store = new MemoryStore();
    const { impl, calls } = fakeFetch({ '/auth/login': () => envelope(session('a1', 900_000)) });
    const c = client(store, impl);
    const seen: (AuthSession | null)[] = [];
    c.onAuthChange((s) => seen.push(s));

    await c.signIn('a@example.com', 'pw');

    assert.deepEqual(calls[0], {
      route: '/auth/login',
      body: { email: 'a@example.com', password: 'pw' },
    });
    assert.equal(store.value?.token.accessToken, 'a1');
    assert.equal(seen.length, 1);
    assert.equal(await c.getAccessToken(), 'a1');
  });

  it('surfaces a refused sign-in with its status and stores nothing', async () => {
    const store = new MemoryStore();
    const { impl } = fakeFetch({ '/auth/login': () => new Response('{}', { status: 401 }) });
    await assert.rejects(client(store, impl).signIn('a@example.com', 'bad'), (err: unknown) => {
      return err instanceof AuthRequestError && err.status === 401;
    });
    assert.equal(store.value, null);
  });

  it('returns the stored token without a request while it is fresh', async () => {
    const { impl, calls } = fakeFetch({});
    const c = client(new MemoryStore(session('a1', REFRESH_SKEW_MS + 1000)), impl);
    assert.equal(await c.getAccessToken(), 'a1');
    assert.equal(calls.length, 0);
  });

  it('renews inside the skew and keeps the rotated refresh token', async () => {
    const store = new MemoryStore(session('a1', REFRESH_SKEW_MS - 1000));
    const { impl, calls } = fakeFetch({
      '/auth/refresh': () =>
        envelope({
          accessToken: 'a2',
          refreshToken: 'refresh-2',
          expiresAt: new Date(NOW + 900_000).toISOString(),
        }),
    });
    const c = client(store, impl);

    assert.equal(await c.getAccessToken(), 'a2');
    assert.deepEqual(calls[0]?.body, { refreshToken: 'refresh-1' });
    assert.equal(store.value?.token.refreshToken, 'refresh-2');
    assert.equal(store.value?.user.email, 'a@example.com');
  });

  it('spends the refresh token once for concurrent callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { impl, calls } = fakeFetch({
      '/auth/refresh': async () => {
        await gate;
        return envelope({
          accessToken: 'a2',
          refreshToken: 'refresh-2',
          expiresAt: new Date(NOW + 900_000).toISOString(),
        });
      },
    });
    const c = client(new MemoryStore(session('a1', 0)), impl);

    const both = Promise.all([c.getAccessToken(), c.getAccessToken()]);
    release();
    assert.deepEqual(await both, ['a2', 'a2']);
    assert.equal(calls.length, 1);
  });

  it('keeps the presented token when the grace-window answer omits a successor', async () => {
    const store = new MemoryStore(session('a1', 0));
    const { impl } = fakeFetch({
      '/auth/refresh': () =>
        envelope({ accessToken: 'a2', expiresAt: new Date(NOW + 900_000).toISOString() }),
    });
    await client(store, impl).getAccessToken();
    assert.equal(store.value?.token.refreshToken, 'refresh-1');
  });

  it('signs out when the API refuses the refresh token (401)', async () => {
    const store = new MemoryStore(session('a1', 0));
    const { impl } = fakeFetch({ '/auth/refresh': () => new Response('{}', { status: 401 }) });
    const c = client(store, impl);
    const seen: (AuthSession | null)[] = [];
    c.onAuthChange((s) => seen.push(s));

    await assert.rejects(c.getAccessToken(), SignedOutError);
    assert.equal(store.value, null);
    assert.deepEqual(seen, [null]);
  });

  it('keeps the session through a transient failure (503, network)', async () => {
    for (const answer of [
      () => new Response('{}', { status: 503 }),
      () => Promise.reject(new TypeError('offline')),
    ]) {
      const store = new MemoryStore(session('a1', 0));
      const { impl } = fakeFetch({ '/auth/refresh': answer as () => Promise<Response> });
      const c = client(store, impl);
      await assert.rejects(c.getAccessToken(), (err: unknown) => !(err instanceof SignedOutError));
      assert.equal(store.value?.token.refreshToken, 'refresh-1');
    }
  });

  it('throws SignedOutError with no session', async () => {
    const { impl } = fakeFetch({});
    await assert.rejects(client(new MemoryStore(), impl).getAccessToken(), SignedOutError);
  });

  it('signs out locally even when the revoke call fails', async () => {
    const store = new MemoryStore(session('a1', 900_000));
    const { impl, calls } = fakeFetch({
      '/auth/revoke': () => Promise.reject(new TypeError('offline')),
    });
    await client(store, impl).signOut();
    assert.equal(store.value, null);
    assert.deepEqual(calls[0], { route: '/auth/revoke', body: { refreshToken: 'refresh-1' } });
  });

  it('does not need AbortSignal.timeout, which Hermes lacks', async () => {
    const original = AbortSignal.timeout;
    // @ts-expect-error -- simulating the React Native runtime
    AbortSignal.timeout = undefined;
    try {
      const { impl } = fakeFetch({ '/auth/login': () => envelope(session('a1', 900_000)) });
      await client(new MemoryStore(), impl).signIn('a@example.com', 'pw');
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it('reads an unreadable store as signed out', async () => {
    const broken: SessionStore = {
      load: () => Promise.reject(new Error('keystore locked')),
      save: async () => {},
      clear: async () => {},
    };
    const { impl } = fakeFetch({});
    assert.equal(await client(broken, impl).getSession(), null);
  });
});
