import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, en } from '@chatofy/i18n';

/**
 * The extension's read of the account's credits, and the words for the credit
 * codes. A failure at any stage reads back as a message beside whatever did
 * load, never as a thrown exception: the popup must render either way.
 */

const API = 'http://localhost:3000';

/**
 * The words are read from the dictionary, not pinned here, and the browser
 * language is pinned to English: Node's `navigator.languages` follows the
 * machine's `LANG`, so on a Vietnamese desktop the module would otherwise
 * format "36.000 credit" and every amount below would be a different string.
 */
const t = createTranslator(en);
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
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
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
    expect(result.message).toBe(t('extension.credits.usageLoadFailed', { status: 503 }));
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
    expect(result.message).toBe(t('extension.credits.unreadable'));
  });

  it('asks for a sign-in, and calls nothing, without a token', async () => {
    installChrome(null);
    const fetchMock = stubApi({});
    const { loadCredits } = await import('./credits');

    const result = await loadCredits(API);

    expect(result).toEqual({
      balance: null,
      usage: [],
      message: t('extension.credits.signInToSee'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The same reads in Vietnamese: the dictionary's words, and the reader's own
 * digit grouping rather than the English comma.
 */
describe('in Vietnamese', () => {
  it('formats amounts and failures in the browser language', async () => {
    vi.stubGlobal('navigator', { language: 'vi-VN', languages: ['vi-VN', 'en-US'] });
    const { vi: viMessages } = await import('@chatofy/i18n');
    const tvi = createTranslator(viMessages);
    const { formatCredits, creditErrorMessage } = await import('./credits');

    expect(formatCredits(1)).toBe(tvi('common.billing.creditAmountOne'));
    expect(formatCredits(36000)).toBe(tvi('common.billing.creditAmount', { credits: '36.000' }));
    expect(
      creditErrorMessage({ source: 'server', code: 'credits_low' }, { turnOpened: true }),
    ).toBe(tvi('common.billing.lowUnknown'));
  });
});

describe('credit amounts', () => {
  it('writes the singular by hand and leads a row with its direction', async () => {
    const { formatCredits, formatSignedCredits } = await import('./credits');
    const amount = (credits: string) => t('common.billing.creditAmount', { credits });
    expect(formatCredits(1)).toBe(t('common.billing.creditAmountOne'));
    expect(formatCredits(2.5)).toBe(amount('2.5'));
    expect(formatCredits(36000)).toBe(amount('36,000'));
    expect(formatSignedCredits(-1.5)).toBe(`−${amount('1.5')}`);
    expect(formatSignedCredits(600)).toBe(`+${amount('600')}`);
  });
});

describe('creditErrorMessage', () => {
  it('says a refused start apart from a leg that ran out', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(
      creditErrorMessage({ source: 'server', code: 'credits_exhausted' }, { turnOpened: false }),
    ).toBe(t('common.billing.startRefused'));
    expect(
      creditErrorMessage({ source: 'server', code: 'credits_exhausted' }, { turnOpened: true }),
    ).toBe(t('extension.credits.exhausted'));
    expect(
      creditErrorMessage({ source: 'server', code: 'credits_unavailable' }, { turnOpened: true }),
    ).toBe(t('common.billing.unavailable'));
  });

  it('says a low balance keeps translating, with the amount when it was sent', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(
      creditErrorMessage(
        { source: 'server', code: 'credits_low', remainingCreditSeconds: 90 },
        { turnOpened: true },
      ),
    ).toBe(
      t('common.billing.low', { credits: t('common.billing.creditAmount', { credits: '1.5' }) }),
    );
    expect(
      creditErrorMessage({ source: 'server', code: 'credits_low' }, { turnOpened: true }),
    ).toBe(t('common.billing.lowUnknown'));
  });

  it('leaves every other code to the server message', async () => {
    const { creditErrorMessage } = await import('./credits');
    expect(
      creditErrorMessage({ source: 'server', code: 'rate_limited' }, { turnOpened: true }),
    ).toBeNull();
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
