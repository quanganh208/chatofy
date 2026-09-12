// Small shared helpers for fetch-based providers.
import { ProviderConnectionError } from '../errors/provider-errors.js';

/**
 * Deadlines for the local speech sidecars.
 *
 * Every one of these is sized well above the measured worst case, because a
 * deadline that cuts a slow-but-working call is a worse fault than the hang it
 * replaces: the caller loses a turn that was about to succeed. They exist to
 * bound the pathological case, not to enforce a latency target.
 *
 * Why any deadline at all: a translating turn holds one of the API's six global
 * turn slots, and the idle sweep deliberately skips translating turns. An
 * unbounded call therefore pins a slot for the life of the process, and once the
 * slots are gone every client is refused `too_many_turns` — at which point the
 * web client retries and then discards the audio it was holding. A hung sidecar
 * became lost words that way; these turn it into one failed turn.
 */

/** `POST /transcribe`. Measured warm: 70-200ms; ~250ms for a full 8s window. */
export const LOCAL_STT_TIMEOUT_MS = 5_000;

/** `POST /embed`. Same sidecar and a smaller model than transcription. */
export const LOCAL_EMBED_TIMEOUT_MS = 5_000;

/** `POST /synthesize`. Measured p95 1125ms per clause. */
export const LOCAL_TTS_TIMEOUT_MS = 15_000;

/** `GET /voices`. A small catalog read, off the turn path. */
export const LOCAL_TTS_VOICES_TIMEOUT_MS = 5_000;

/**
 * ElevenLabs cloud calls (STT and TTS). Not the production backend —
 * `AI_STT_PROVIDER`/`AI_TTS_PROVIDER` default to `local` — but selectable, and
 * a hung cloud call pins a turn slot exactly like a hung local one. Cloud
 * latency varies with network in a way localhost does not, so the budget is
 * looser than the local ones while still bounding the hang.
 */
export const ELEVENLABS_TIMEOUT_MS = 30_000;

/**
 * `fetch` that cannot hang, reporting a timeout as distinct from a refusal.
 *
 * Shared rather than repeated at each call site: all provider calls wrap the
 * same two failures into the same error class, and the copy that drifted would be
 * the one nobody was reading. `label` keeps each caller's own wording so the log
 * still says which endpoint gave up.
 *
 * Note: a caller-supplied `init.signal` is silently overridden by the deadline.
 * No current caller passes one; if one ever does, that caller wants its own
 * abort handling rather than this helper's.
 */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // `AbortSignal.timeout` rejects with a TimeoutError; AbortError is accepted
    // too so a caller-supplied signal reports as a timeout rather than as a
    // connection refusal, which would send an operator to the wrong sidecar.
    const name = err instanceof Error ? err.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    throw new ProviderConnectionError(
      timedOut ? `${label} timed out after ${timeoutMs}ms` : `${label} failed`,
      err,
    );
  }
}

/** Truncate an upstream error body so we never log huge payloads. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Map an audio MIME type to a file extension for multipart uploads. */
export function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  };
  return map[mimeType.split(';')[0]?.trim() ?? ''] ?? 'bin';
}
