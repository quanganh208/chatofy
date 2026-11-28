import type { TranslationHints } from '@chatofy/types';
import type { ExtensionMessage } from './messages';

/**
 * What a capture needs from storage, asked of the worker by the offscreen document.
 *
 * An offscreen document may use `chrome.runtime` and nothing else: `chrome.storage`
 * is `undefined` there. The offscreen document used to read the stored token and
 * settings itself, so every Start died before a socket opened with "Cannot read
 * properties of undefined (reading 'local')", shown as the meeting-audio error. The
 * token, its renewal and the saved-context lookup all touch storage, so all three
 * now run in the worker (`offscreen-request-handler.ts`) and come back as the reply
 * to a message.
 *
 * This file is the offscreen half and imports nothing that touches storage, so the
 * document's bundle cannot reach it either; the spec walks the import graph to
 * keep it that way.
 */

export type OffscreenWorkerRequest = Extract<
  ExtensionMessage,
  { to: 'worker'; type: 'capture.token' | 'capture.hints' }
>;

/** How the offscreen document reaches the worker: `chrome.runtime.sendMessage`. */
export type SendToWorker = (message: OffscreenWorkerRequest) => Promise<unknown>;

/** The token to open a capture's sockets with, or `null` ("sign in first"). */
export async function requestCaptureToken(send: SendToWorker): Promise<string | null> {
  const reply = await send({ to: 'worker', type: 'capture.token' }).catch(() => null);
  return typeof reply === 'string' && reply.length > 0 ? reply : null;
}

/** The selected context's hints, or `undefined` for none, failure included. */
export async function requestContextHints(
  send: SendToWorker,
  contextId: string | undefined,
): Promise<TranslationHints | undefined> {
  const reply = await send({ to: 'worker', type: 'capture.hints', contextId }).catch(() => null);
  return typeof reply === 'object' && reply !== null ? reply : undefined;
}
