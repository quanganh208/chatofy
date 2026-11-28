import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { answerOffscreenRequest, type WorkerStorageSources } from './offscreen-request-handler';
import { requestCaptureToken, requestContextHints } from './offscreen-worker-requests';

const sources = (overrides: Partial<WorkerStorageSources> = {}): WorkerStorageSources => ({
  loadApiBaseUrl: vi.fn(() => Promise.resolve('https://api.example.test')),
  freshAccessToken: vi.fn(() => Promise.resolve('access-1')),
  contextHints: vi.fn(() => Promise.resolve({ topic: 'launch' })),
  ...overrides,
});

describe('answerOffscreenRequest (worker side)', () => {
  it('answers the token from storage, renewed against the stored API base URL', async () => {
    const s = sources();
    await expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.token' }, {}, s),
    ).resolves.toBe('access-1');
    expect(s.freshAccessToken).toHaveBeenCalledWith('https://api.example.test');
  });

  it('refuses any sender with a tab, so a meeting page never receives the token', () => {
    const s = sources();
    expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.token' }, { tab: { id: 7 } }, s),
    ).toBeNull();
    expect(
      answerOffscreenRequest(
        { to: 'worker', type: 'capture.hints', contextId: 'c1' },
        { tab: { id: 7 } },
        s,
      ),
    ).toBeNull();
    expect(s.loadApiBaseUrl).not.toHaveBeenCalled();
  });

  it('answers the selected context as hints, and "none" as null rather than undefined', async () => {
    const s = sources();
    await expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.hints', contextId: 'c1' }, {}, s),
    ).resolves.toEqual({ topic: 'launch' });
    expect(s.contextHints).toHaveBeenCalledWith('https://api.example.test', 'c1');

    const none = sources({ contextHints: vi.fn(() => Promise.resolve(undefined)) });
    await expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.hints' }, {}, none),
    ).resolves.toBeNull();
  });

  it('turns a storage failure into null instead of a rejection', async () => {
    const broken = sources({
      loadApiBaseUrl: vi.fn(() => Promise.reject(new Error('no storage'))),
    });
    await expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.token' }, {}, broken),
    ).resolves.toBeNull();
    await expect(
      answerOffscreenRequest({ to: 'worker', type: 'capture.hints' }, {}, broken),
    ).resolves.toBeNull();
  });
});

describe('requestCaptureToken / requestContextHints (offscreen side)', () => {
  it('returns the token the worker replied with', async () => {
    const send = vi.fn(() => Promise.resolve('access-1'));
    await expect(requestCaptureToken(send)).resolves.toBe('access-1');
    expect(send).toHaveBeenCalledWith({ to: 'worker', type: 'capture.token' });
  });

  it('reads no reply, an empty reply or a failed send as "no token"', async () => {
    await expect(requestCaptureToken(vi.fn(() => Promise.resolve(undefined)))).resolves.toBeNull();
    await expect(requestCaptureToken(vi.fn(() => Promise.resolve('')))).resolves.toBeNull();
    await expect(
      requestCaptureToken(vi.fn(() => Promise.reject(new Error('gone')))),
    ).resolves.toBeNull();
  });

  it('returns hints, and reads null or a failed send as "no context"', async () => {
    const send = vi.fn(() => Promise.resolve({ topic: 'launch' }));
    await expect(requestContextHints(send, 'c1')).resolves.toEqual({ topic: 'launch' });
    expect(send).toHaveBeenCalledWith({ to: 'worker', type: 'capture.hints', contextId: 'c1' });

    await expect(
      requestContextHints(
        vi.fn(() => Promise.resolve(null)),
        'c1',
      ),
    ).resolves.toBeUndefined();
    await expect(
      requestContextHints(
        vi.fn(() => Promise.reject(new Error('gone'))),
        undefined,
      ),
    ).resolves.toBeUndefined();
  });
});

/**
 * The regression this file exists for, stated against the source: the offscreen
 * document must not import what reads `chrome.storage`, which is `undefined` there.
 * It used to import `settings` and `access-token` directly and call them on every
 * Start.
 *
 * Direct imports, not the whole graph, on purpose: the session reaches
 * `credits.ts` for its pure error mapping, and that module's `loadCredits` (popup
 * only) reads the token. Importing it is harmless; calling it here would not be,
 * and calling is what a direct import is for. The token readers are named because
 * they reach storage through `token-storage.ts` rather than spelling it out.
 */
describe('offscreen document imports', () => {
  const ENTRY = fileURLToPath(new URL('../entrypoints/offscreen/main.ts', import.meta.url));
  const TOKEN_READERS = ['access-token.ts', 'translation-contexts.ts'];
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Relative, non-type imports of `source`, resolved as `.ts` files next to `file`. */
  const directImports = (file: string, source = readFileSync(file, 'utf8')): string[] =>
    [...stripComments(source).matchAll(/^import\s+(?!type\s)[^;]*?from\s+'(\.[^']+)'/gms)].map(
      (match) => resolve(dirname(file), `${match[1]}.ts`),
    );

  const readsStorage = (file: string) =>
    TOKEN_READERS.some((name) => file.endsWith(name)) ||
    /chrome\.storage/.test(stripComments(readFileSync(file, 'utf8')));

  it('imports nothing that reads chrome.storage or the stored token, and reads none itself', () => {
    const offenders = [ENTRY, ...directImports(ENTRY)].filter(readsStorage);
    expect(offenders).toEqual([]);
  });

  it('still catches the imports that caused the bug', () => {
    // Guards the guard: the scanner, run over the entry's previous import lines,
    // must find and flag every one of them.
    const previous = [
      "import { getFreshAccessToken } from '../../src/access-token';",
      "import { loadSettings } from '../../src/settings';",
      "import { listTranslationContexts, resolveContext, toHints } from '../../src/translation-contexts';",
      "import type { CaptureSettings } from '../../src/messages';",
    ].join('\n');
    const flagged = directImports(ENTRY, previous)
      .filter(readsStorage)
      .map((file) => file.slice(file.lastIndexOf('/') + 1));
    expect(flagged).toEqual(['access-token.ts', 'settings.ts', 'translation-contexts.ts']);
  });
});
