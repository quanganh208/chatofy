// A streamed fetch that cannot hang, and that can tell a caller's abort apart
// from a backend that stopped answering.
//
// `fetchWithDeadline` bounds the whole request with one timer, which is the
// wrong shape for a stream: a turn's synthesis legitimately runs for tens of
// seconds, so any single deadline long enough to cover it would also let a
// stalled stream pin a turn slot for that long. Three bounds replace it:
//
// - first byte: how long to wait for headers. The TTS sidecar sends them only
//   once the first audio exists, so this also covers queueing for the engine;
// - idle: the longest silence between two chunks of a live stream;
// - total: the ceiling on the whole thing, whatever the pace.
//
// It also keeps the caller's own signal instead of overriding it, and reports
// its abort as `ProviderAbortedError` — a listener leaving is not a timeout.
import { ProviderAbortedError, ProviderConnectionError } from '../errors/provider-errors.js';

export interface StreamDeadlines {
  firstByteMs: number;
  idleMs: number;
  totalMs: number;
  /** The caller's abort. Never reported as a timeout. */
  signal: AbortSignal;
}

export interface StreamedResponse {
  response: Response;
  /**
   * The body, chunk by chunk, under the idle and total deadlines. Leaving the
   * loop early cancels the request, so the backend sees the disconnect.
   */
  chunks: AsyncIterable<Uint8Array>;
  /**
   * For a response that will not be streamed after all (an error status read
   * as text instead): stops the timers, which would otherwise outlive it.
   */
  discard(): void;
}

export async function fetchStreamWithDeadlines(
  url: string,
  init: RequestInit,
  deadlines: StreamDeadlines,
  label: string,
): Promise<StreamedResponse> {
  const timeouts = new AbortController();
  let expired = '';
  const expire = (what: string) => () => {
    expired = what;
    timeouts.abort();
  };
  const total = setTimeout(
    expire(`timed out after ${deadlines.totalMs}ms in total`),
    deadlines.totalMs,
  );
  let pending = setTimeout(
    expire(`timed out after ${deadlines.firstByteMs}ms waiting for audio`),
    deadlines.firstByteMs,
  );
  const clearTimers = () => {
    clearTimeout(total);
    clearTimeout(pending);
  };

  // Ordered: the caller's abort wins when both happened, because a listener who
  // left is the fact worth recording — the timer that fired after is noise.
  const classify = (err: unknown) => {
    if (deadlines.signal.aborted) {
      return new ProviderAbortedError(`${label} aborted by caller`, err);
    }
    if (expired) return new ProviderConnectionError(`${label} ${expired}`, err);
    return new ProviderConnectionError(`${label} failed`, err);
  };

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([deadlines.signal, timeouts.signal]),
    });
  } catch (err) {
    clearTimers();
    throw classify(err);
  }
  clearTimeout(pending);

  const armIdle = () => {
    clearTimeout(pending);
    pending = setTimeout(expire(`stalled for more than ${deadlines.idleMs}ms`), deadlines.idleMs);
  };

  async function* read(): AsyncGenerator<Uint8Array> {
    const body = response.body;
    if (!body) {
      clearTimers();
      return;
    }
    const reader = body.getReader();
    let finished = false;
    try {
      armIdle();
      for (;;) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch (err) {
          finished = true;
          throw classify(err);
        }
        if (next.done) {
          finished = true;
          return;
        }
        armIdle();
        yield next.value;
      }
    } finally {
      clearTimers();
      // A consumer that stopped early: close the connection so the backend
      // stops synthesizing for nobody instead of filling a buffer.
      if (!finished) await reader.cancel().catch(() => undefined);
    }
  }

  return { response, chunks: read(), discard: clearTimers };
}
