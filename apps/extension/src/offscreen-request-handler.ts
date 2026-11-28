import type { TranslationHints } from '@chatofy/types';
import { getFreshAccessToken } from './access-token';
import type { OffscreenWorkerRequest } from './offscreen-worker-requests';
import { loadSettings } from './settings';
import { listTranslationContexts, resolveContext, toHints } from './translation-contexts';

/**
 * The worker's half of `offscreen-worker-requests.ts`: answers what the offscreen
 * document cannot read, because only the worker has `chrome.storage`.
 *
 * Kept out of `entrypoints/background.ts`, which the unit suite does not cover: the
 * refusal below is the part that must not regress silently.
 */

/** The storage-backed calls the worker answers with, injectable for tests. */
export interface WorkerStorageSources {
  loadApiBaseUrl: () => Promise<string>;
  freshAccessToken: (apiBaseUrl: string) => Promise<string | null>;
  contextHints: (
    apiBaseUrl: string,
    contextId: string | undefined,
  ) => Promise<TranslationHints | undefined>;
}

export const chromeWorkerStorageSources: WorkerStorageSources = {
  loadApiBaseUrl: async () => (await loadSettings()).apiBaseUrl,
  freshAccessToken: getFreshAccessToken,
  // `listTranslationContexts` never throws: a failure is an empty list, so a
  // meeting can always start, with or without a context.
  contextHints: async (apiBaseUrl, contextId) => {
    const { contexts } = await listTranslationContexts(apiBaseUrl);
    return toHints(resolveContext(contexts, contextId));
  },
};

/**
 * The answer to an offscreen request, or `null` when the worker must not answer.
 *
 * Refused when the sender is a tab. Every extension context can message the worker,
 * content scripts included, and a content script runs inside the meeting page; the
 * bearer token is for the offscreen document, which has no tab, and never for a
 * page. Replies are JSON, so "no hints" travels as `null`, never `undefined`.
 */
export function answerOffscreenRequest(
  request: OffscreenWorkerRequest,
  sender: { tab?: unknown },
  sources: WorkerStorageSources = chromeWorkerStorageSources,
): Promise<string | TranslationHints | null> | null {
  if (sender.tab !== undefined) return null;

  if (request.type === 'capture.token') {
    return (
      sources
        .loadApiBaseUrl()
        .then((apiBaseUrl) => sources.freshAccessToken(apiBaseUrl))
        // A worker that could not read storage is a capture with no token, which
        // the capture already reports as "sign in first", not an unhandled rejection.
        .catch(() => null)
    );
  }

  return sources
    .loadApiBaseUrl()
    .then((apiBaseUrl) => sources.contextHints(apiBaseUrl, request.contextId))
    .then((hints) => hints ?? null)
    .catch(() => null);
}
