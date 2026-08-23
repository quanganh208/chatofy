import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `verifyAccessToken` — the popup's answer to a token that can now die before it
 * expires.
 *
 * A stored token used to be proof the user was signed in, because the only way
 * one stopped working was reaching its `exp`. A password reset revokes tokens
 * ahead of that, so the stored value and the API's opinion can now disagree —
 * and a refused socket upgrade carries no readable status, so without this the
 * popup would keep claiming "signed in" while every capture silently failed.
 *
 * What is asserted here is mostly what does NOT clear the token. Fail-closed is
 * wrong for this: the extension runs on laptops that sleep, change networks and
 * sit behind captive portals, and signing the user out every time the API is
 * briefly unreachable would be a far more common failure than the one being
 * fixed.
 */

const KEY = 'chatofy.accessToken';

let stored: Record<string, unknown>;
let removed: string[];

function installChrome(token: string | null) {
  stored = token === null ? {} : { [KEY]: token };
  removed = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in stored ? { [key]: stored[key] } : {}),
        set: (patch: Record<string, unknown>) => {
          Object.assign(stored, patch);
          return Promise.resolve();
        },
        remove: (key: string) => {
          removed.push(key);
          delete stored[key];
          return Promise.resolve();
        },
      },
    },
  });
}

/** A fetch that answers every call with one status. */
function fetchAnswering(status: number) {
  return vi.fn().mockResolvedValue({ status });
}

async function verify(apiBaseUrl = 'http://localhost:3000') {
  const { verifyAccessToken } = await import('./access-token');
  return verifyAccessToken(apiBaseUrl);
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
    expect(url).toBe('http://localhost:3000/auth/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer a.stored.token');
  });

  it('clears a token the API refuses', async () => {
    // The one answer that is proof: the API looked at this token and said no.
    installChrome('a.revoked.token');
    vi.stubGlobal('fetch', fetchAnswering(401));

    await expect(verify()).resolves.toBe(false);
    expect(removed).toEqual([KEY]);
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
