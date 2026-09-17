import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';

/**
 * The extension's read of a saved AI Context library.
 *
 * `getFreshAccessToken` is exercised by `access-token.spec.ts`; what matters
 * here is that a failure at any stage — no session, an unreachable API, a
 * non-2xx response, a body that fails to parse — reads back as an empty list
 * with a message rather than as a thrown exception, because this must never be
 * the thing that stops a meeting from starting.
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

function context(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Sprint planning',
    topic: null,
    hotwords: [],
    glossary: [],
    style: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listTranslationContexts', () => {
  it('a failed list returns empty rather than throwing', async () => {
    installChrome('a-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { listTranslationContexts } = await import('./translation-contexts');
    const result = await listTranslationContexts(API);

    expect(result.contexts).toEqual([]);
    expect(result.message).toBeDefined();
  });

  it('returns empty with a message rather than throwing on a non-2xx response', async () => {
    installChrome('a-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, null)));

    const { listTranslationContexts } = await import('./translation-contexts');
    const result = await listTranslationContexts(API);

    expect(result.contexts).toEqual([]);
    expect(result.message).toBeDefined();
  });

  it('returns empty with a message when the body fails to parse', async () => {
    installChrome('a-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { success: true, data: { contexts: 'not-a-list' } })),
    );

    const { listTranslationContexts } = await import('./translation-contexts');
    const result = await listTranslationContexts(API);

    expect(result.contexts).toEqual([]);
    expect(result.message).toBeDefined();
  });

  it('returns empty with a message rather than asking, when signed out', async () => {
    installChrome(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { listTranslationContexts } = await import('./translation-contexts');
    const result = await listTranslationContexts(API);

    expect(result.contexts).toEqual([]);
    expect(result.message).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a successful list', async () => {
    installChrome('a-token');
    const one = context();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { contexts: [one] } })),
    );

    const { listTranslationContexts } = await import('./translation-contexts');
    const result = await listTranslationContexts(API);

    expect(result.contexts).toEqual([one]);
    expect(result.message).toBeUndefined();
  });
});

describe('resolveContext', () => {
  it('resolves a stored id against the fetched list', async () => {
    const { resolveContext } = await import('./translation-contexts');
    const one = context({ id: 'ctx-1' });
    expect(resolveContext([one], 'ctx-1')).toBe(one);
  });

  // The rule `settings.ts` relies on: a stale id is harmless because it resolves
  // to nothing here, not because it was stripped from storage.
  it('returns null for an id that does not resolve', async () => {
    const { resolveContext } = await import('./translation-contexts');
    expect(resolveContext([context({ id: 'ctx-1' })], 'ctx-deleted')).toBeNull();
  });

  it('returns null for no selection', async () => {
    const { resolveContext } = await import('./translation-contexts');
    expect(resolveContext([context()], undefined)).toBeNull();
  });
});

describe('toHints', () => {
  it('returns undefined for no selection', async () => {
    const { toHints } = await import('./translation-contexts');
    expect(toHints(null)).toBeUndefined();
  });

  it('toHints omits an empty glossary', async () => {
    const { toHints } = await import('./translation-contexts');
    const hints = toHints(context({ topic: 'Cardiology', glossary: [] }));
    expect(hints).toEqual({ topic: 'Cardiology' });
    expect(hints).not.toHaveProperty('glossary');
  });

  it('carries vi/en pairs through unchanged', async () => {
    const { toHints } = await import('./translation-contexts');
    const glossary = [{ vi: 'khám sức khỏe', en: 'checkup' }];
    expect(toHints(context({ glossary }))?.glossary).toEqual(glossary);
  });

  it('drops a null topic and style, and an empty hotwords list', async () => {
    const { toHints } = await import('./translation-contexts');
    expect(toHints(context())).toEqual({});
  });
});
