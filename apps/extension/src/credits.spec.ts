import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The extension's read of the account's credits, and the words for the credit
 * codes. A failure at any stage reads back as a message beside whatever did
 * load, never as a thrown exception: the popup must render either way.
 */

const API = 'http://localhost:3000';
const TOKEN_KEY = 'chatofy.accessToken';

function installChrome(accessToken: string | null) {
  const stored: Record<string, unknown> = {};
  if (accessToken !== null) stored[TOKEN_KEY] = accessToken;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in stored ? { [key]: stored[key] } : {}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
    },
  });
}

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) };
}

const balance = {
  totalCredits: 130.5,
  planCredits: 120,
  topupCredits: 10.5,
  planResetsAt: '2026-12-01T00:00:00.000Z',
  plan: 'free',
  proSource: null,
  checkoutAllowed: false,
  rails: { polar: 'unavailable', sepay: 'unavailable' },
};

const entry = (index: number, kind = 'translate') => ({
  id: `entry-${index}`,
  at: '2026-11-09T10:00:00.000Z',
  kind,
  credits: -1.5,
  conversationId: null,
  label: 'Translation',
});

/** Answers by path, the way the API routes them. */
function stubApi(routes: Record<string, () => Promise<unknown>>) {
  const fetchMock = vi.fn((url: string) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    return route ? route() : Promise.resolve(jsonResponse(404, null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadCredits', () => {
  it('reads the balance and the newest five rows with the stored token', async () => {
    installChrome('token-1');
    const fetchMock = stubApi({
      '/billing/me': () => Promise.resolve(jsonResponse(200, { success: true, data: balance })),
      '/billing/usage': () =>
        Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { entries: Array.from({ length: 20 }, (_, i) => entry(i)), nextCursor: 'x' },
          }),
        ),
    });
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result.message).toBeUndefined();
    expect(result.balance?.totalCredits).toBe(130.5);
    expect(result.usage.map((row) => row.id)).toEqual([
      'entry-0',
      'entry-1',
      'entry-2',
      'entry-3',
      'entry-4',
    ]);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toEqual({ authorization: 'Bearer token-1' });
    }
  });

  it('drops a usage kind this build does not know instead of failing the list', async () => {
    installChrome('token-1');
    stubApi({
      '/billing/me': () => Promise.resolve(jsonResponse(200, { success: true, data: balance })),
      '/billing/usage': () =>
        Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { entries: [entry(0), entry(1, 'added_later'), entry(2)], nextCursor: null },
          }),
        ),
    });
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result.usage.map((row) => row.id)).toEqual(['entry-0', 'entry-2']);
    expect(result.message).toBeUndefined();
  });

  it('keeps the balance when only the usage fails', async () => {
    installChrome('token-1');
    stubApi({
      '/billing/me': () => Promise.resolve(jsonResponse(200, { success: true, data: balance })),
      '/billing/usage': () => Promise.resolve(jsonResponse(503, null)),
    });
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result.balance?.plan).toBe('free');
    expect(result.usage).toEqual([]);
    expect(result.message).toBe('Could not load your usage (HTTP 503)');
  });

  it('reports an unreachable API and an unreadable balance without throwing', async () => {
    installChrome('token-1');
    stubApi({
      '/billing/me': () =>
        Promise.resolve(jsonResponse(200, { success: true, data: { totalCredits: 'lots' } })),
      '/billing/usage': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result.balance).toBeNull();
    expect(result.message).toBe('Could not read your credits');
  });

  it('asks for a sign-in, and calls nothing, without a token', async () => {
    installChrome(null);
    const fetchMock = stubApi({});
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result).toEqual({ balance: null, usage: [], message: 'Sign in to see your credits' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('credit amounts', () => {
  it('writes the singular by hand and leads a row with its direction', async () => {
    const { formatCredits, formatSignedCredits } = await import('./credits');
    expect(formatCredits(1)).toBe('1 credit');
    expect(formatCredits(2.5)).toBe('2.5 credits');
    expect(formatCredits(36000)).toBe('36,000 credits');
    expect(formatSignedCredits(-1.5)).toBe('−1.5 credits');
    expect(formatSignedCredits(600)).toBe('+600 credits');
  });
});

describe('creditErrorMessage', () => {
  it('says a refused start apart from a leg that ran out', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(creditErrorMessage({ code: 'credits_exhausted' }, { turnOpened: false })).toBe(
      'You need at least 1 credit to start translating.',
    );
    expect(creditErrorMessage({ code: 'credits_exhausted' }, { turnOpened: true })).toMatch(
      /^Your credits ran out, so translation stopped\./,
    );
    expect(creditErrorMessage({ code: 'credits_unavailable' }, { turnOpened: true })).toMatch(
      /could not be checked/,
    );
  });

  it('says a low balance keeps translating, with the amount when it was sent', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(
      creditErrorMessage({ code: 'credits_low', remainingCreditSeconds: 90 }, { turnOpened: true }),
    ).toBe('About 1.5 credits left. Translation keeps going until they run out.');
    expect(creditErrorMessage({ code: 'credits_low' }, { turnOpened: true })).toBe(
      'Your credits are running low. Translation keeps going until they run out.',
    );
  });

  it('leaves every other code to the server message', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(creditErrorMessage({ code: 'rate_limited' }, { turnOpened: true })).toBeNull();
    expect(creditErrorMessage(undefined, { turnOpened: true })).toBeNull();
  });
});

describe('CreditContext', () => {
  it('keeps whether a turn opened, until reset', async () => {
    const { CreditContext } = await import('./credits');
    const context = new CreditContext();
    context.observe({
      type: 'server.session.ready',
      sessionId: 's',
      turnId: 't',
    } as never);
    expect(context.turnOpened).toBe(true);

    context.reset();
    expect(context.turnOpened).toBe(false);
  });
});
