import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The extension's side of a session that can now be renewed.
 *
 * A stored token used to be proof the user was signed in, because the only way
 * one stopped working was reaching its `exp`. A password reset revokes tokens
 * ahead of that, so the stored value and the API's opinion can now disagree —
 * and a refused socket upgrade carries no readable status, so without this the
 * popup would keep claiming "signed in" while every capture silently failed.
 *
 * What is asserted here is mostly what does NOT clear the tokens. Fail-closed is
 * wrong for this: the extension runs on laptops that sleep, change networks and
 * sit behind captive portals, and signing the user out every time the API is
 * briefly unreachable would be a far more common failure than the one being
 * fixed. Since an access token lives fifteen minutes, one 401 is no longer that
 * proof either — the refresh token has to be refused too.
 */

const KEY = 'chatofy.accessToken';
const REFRESH_KEY = 'chatofy.refreshToken';
const API = 'http://localhost:3000';

let stored: Record<string, unknown>;
let removed: string[];

function installChrome(token: string | null, refresh: string | null = null) {
  stored = {};
  if (token !== null) stored[KEY] = token;
  if (refresh !== null) stored[REFRESH_KEY] = refresh;
  removed = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in stored ? { [key]: stored[key] } : {}),
        set: (patch: Record<string, unknown>) => {
          Object.assign(stored, patch);
          return Promise.resolve();
        },
        // Both keys go together, so the real call is given an array; kept as a
        // flat list here so a test can say exactly what was dropped.
        remove: (keys: string | string[]) => {
          for (const key of [keys].flat()) {
            removed.push(key);
            delete stored[key];
          }
          return Promise.resolve();
        },
      },
    },
  });
}

/** One API answer: the two fields the code reads, plus a body when it reads one. */
function answer(status: number, body?: unknown) {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) };
}

/** A fetch that answers every call with one status. */
function fetchAnswering(status: number) {
  return vi.fn().mockResolvedValue(answer(status));
}

/**
 * A fetch routed by path, since the interesting cases ask two questions: the
 * probe, then the refresh, and the whole point is that they can differ.
 */
function fetchRouting(routes: Record<string, ReturnType<typeof answer> | Error>) {
  return vi.fn().mockImplementation((url: string) => {
    const match = Object.entries(routes).find(([path]) => url.endsWith(path));
    if (!match) throw new Error(`unrouted request: ${url}`);
    const [, response] = match;
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });
}

/** A `/auth/refresh` 200: the token half alone, no user profile. */
function renewed(accessToken: string, refreshToken: string) {
  return answer(200, {
    success: true,
    data: { accessToken, refreshToken, expiresAt: '2026-01-01T00:15:00.000Z' },
  });
}

async function verify(apiBaseUrl = API) {
  const { verifyAccessToken } = await import('./access-token');
  return verifyAccessToken(apiBaseUrl);
}

async function fresh(apiBaseUrl = API) {
  const { getFreshAccessToken } = await import('./access-token');
  return getFreshAccessToken(apiBaseUrl);
}

/** The nth request a fetch spy was given, as the two arguments the code passes. */
function requestAt(spy: ReturnType<typeof vi.fn>, index: number): [string, RequestInit] {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at ${index}`);
  return call as [string, RequestInit];
}

function bodyOf(request: [string, RequestInit]) {
  return JSON.parse(request[1].body as string) as Record<string, unknown>;
}

describe('verifyAccessToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports signed out, and asks nothing, when no token is stored', async () => {
    installChrome(null);
    const fetchSpy = fetchAnswering(200);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verify()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps a token the API still accepts', async () => {
    installChrome('a.stored.token');
    const fetchSpy = fetchAnswering(200);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/auth/me`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer a.stored.token');
  });

  it('clears a token the API refuses when there is nothing to renew it with', async () => {
    // A profile signed in before refresh tokens existed: the probe's 401 is the
    // whole answer, because there is no second question to ask.
    installChrome('a.revoked.token');
    vi.stubGlobal('fetch', fetchAnswering(401));

    await expect(verify()).resolves.toBe(false);
    expect(removed).toEqual([KEY, REFRESH_KEY]);
  });

  it('renews on a 401 and keeps the session', async () => {
    // The common case now: fifteen minutes passed while the popup was closed.
    installChrome('an.expired.token', 'a-refresh-token');
    const fetchSpy = fetchRouting({
      '/auth/me': answer(401),
      '/auth/refresh': renewed('a.new.token', 'a-newer-refresh-token'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
    expect(stored[KEY]).toBe('a.new.token');
    expect(stored[REFRESH_KEY]).toBe('a-newer-refresh-token');
    expect(bodyOf(requestAt(fetchSpy, 1))).toEqual({ refreshToken: 'a-refresh-token' });
  });

  it('clears both keys when the refresh is refused too', async () => {
    // Two 401s: the API looked at both credentials and said no to each.
    installChrome('an.expired.token', 'a-revoked-refresh-token');
    vi.stubGlobal('fetch', fetchRouting({ '/auth/me': answer(401), '/auth/refresh': answer(401) }));

    await expect(verify()).resolves.toBe(false);
    expect(removed).toEqual([KEY, REFRESH_KEY]);
    expect(stored).toEqual({});
  });

  it('keeps both keys when the refresh faults', async () => {
    // A 500 answering the refresh says the server broke, not that this family
    // ended — the same distinction the probe already draws.
    installChrome('an.expired.token', 'a-refresh-token');
    vi.stubGlobal('fetch', fetchRouting({ '/auth/me': answer(401), '/auth/refresh': answer(500) }));

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
    expect(stored[REFRESH_KEY]).toBe('a-refresh-token');
  });

  it('keeps both keys when the refresh is rate limited', async () => {
    installChrome('an.expired.token', 'a-refresh-token');
    vi.stubGlobal('fetch', fetchRouting({ '/auth/me': answer(401), '/auth/refresh': answer(429) }));

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
  });

  it('keeps both keys when the refresh cannot be reached', async () => {
    installChrome('an.expired.token', 'a-refresh-token');
    vi.stubGlobal(
      'fetch',
      fetchRouting({ '/auth/me': answer(401), '/auth/refresh': new TypeError('Failed to fetch') }),
    );

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
  });

  it('bounds the refresh, and keeps both keys when that bound fires', async () => {
    // Without the bound there is nothing that ends this call: an API that
    // accepts the connection and never answers would hold a capture forever.
    // A bound that fires is a network failure like any other — it says nothing
    // about the token, so nothing is cleared.
    installChrome('an.expired.token', 'a-refresh-token');
    const fetchSpy = fetchRouting({
      '/auth/me': answer(401),
      '/auth/refresh': new DOMException('The operation was aborted.', 'TimeoutError'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
    expect(requestAt(fetchSpy, 1)[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the token when the API is unreachable', async () => {
    // A laptop waking on a bad network must not be signed out of the extension.
    installChrome('a.stored.token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
  });

  it('keeps the token when the API faults', async () => {
    // A 500 says the server broke, not that this session ended — the same
    // distinction the API itself draws by letting a failed database read escape
    // as a 5xx rather than collapsing it into a 401.
    installChrome('a.stored.token');
    vi.stubGlobal('fetch', fetchAnswering(500));

    await expect(verify()).resolves.toBe(true);
    expect(removed).toEqual([]);
  });
});

/**
 * The token a capture dials with.
 *
 * This is the reason the fifteen-minute access token is survivable: a capture
 * started on a long-idle extension renews before it opens the socket, because a
 * stale token is refused at the HTTP upgrade where there is no readable status
 * to show the user.
 */
describe('getFreshAccessToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renews a stale token before a capture dials', async () => {
    installChrome('an.expired.token', 'a-refresh-token');
    const fetchSpy = vi.fn().mockResolvedValue(renewed('a.new.token', 'a-newer-refresh-token'));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fresh()).resolves.toBe('a.new.token');
    expect(requestAt(fetchSpy, 0)[0]).toBe(`${API}/auth/refresh`);
    expect(stored[KEY]).toBe('a.new.token');
    expect(stored[REFRESH_KEY]).toBe('a-newer-refresh-token');
  });

  it('starts a capture on the stored token when the API cannot be reached', async () => {
    // It may well have minutes left, and the upgrade is the authority either way;
    // refusing to start here would turn a flaky network into a dead button.
    installChrome('a.stored.token', 'a-refresh-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fresh()).resolves.toBe('a.stored.token');
    expect(removed).toEqual([]);
  });

  it('starts a capture on the stored token when nothing can renew it', async () => {
    // No refresh token: a profile from before this existed still captures until
    // its access token runs out.
    installChrome('a.stored.token');
    const fetchSpy = fetchAnswering(200);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fresh()).resolves.toBe('a.stored.token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses, and clears both keys, when the refresh is refused', async () => {
    installChrome('an.expired.token', 'a-revoked-refresh-token');
    vi.stubGlobal('fetch', fetchAnswering(401));

    await expect(fresh()).resolves.toBeNull();
    expect(removed).toEqual([KEY, REFRESH_KEY]);
  });

  it('asks nothing when no token is stored', async () => {
    installChrome(null);
    const fetchSpy = fetchAnswering(200);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fresh()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps both halves of what the login returned', async () => {
    // Storing only the access token would make this a fifteen-minute session.
    installChrome(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        answer(200, {
          success: true,
          data: {
            user: { id: 'u1' },
            token: {
              accessToken: 'a.fresh.token',
              refreshToken: 'a-refresh-token',
              expiresAt: '2026-01-01T00:15:00.000Z',
            },
          },
        }),
      ),
    );

    const { signIn } = await import('./access-token');
    await expect(signIn(API, 'someone@example.com', 'hunter2')).resolves.toEqual({
      ok: true,
      token: 'a.fresh.token',
    });
    expect(stored[KEY]).toBe('a.fresh.token');
    expect(stored[REFRESH_KEY]).toBe('a-refresh-token');
  });
});

describe('signOut', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes this browser's refresh family and clears both keys", async () => {
    installChrome('a.stored.token', 'a-refresh-token');
    const fetchSpy = vi.fn().mockResolvedValue(answer(204));
    vi.stubGlobal('fetch', fetchSpy);

    const { signOut } = await import('./access-token');
    await signOut(API);

    expect(requestAt(fetchSpy, 0)[0]).toBe(`${API}/auth/revoke`);
    expect(bodyOf(requestAt(fetchSpy, 0))).toEqual({ refreshToken: 'a-refresh-token' });
    expect(removed).toEqual([KEY, REFRESH_KEY]);
    expect(stored).toEqual({});
  });

  it('still clears both keys when the revoke fails', async () => {
    // Someone leaving a shared machine must never be held by a request a captive
    // portal will hang; the family expires on its own if it was not told.
    installChrome('a.stored.token', 'a-refresh-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { signOut } = await import('./access-token');
    await signOut(API);

    expect(removed).toEqual([KEY, REFRESH_KEY]);
    expect(stored).toEqual({});
  });

  it('clears without asking when there is no refresh token to revoke', async () => {
    installChrome('a.stored.token');
    const fetchSpy = fetchAnswering(204);
    vi.stubGlobal('fetch', fetchSpy);

    const { signOut } = await import('./access-token');
    await signOut(API);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(removed).toEqual([KEY, REFRESH_KEY]);
  });
});
