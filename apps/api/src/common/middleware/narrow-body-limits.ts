import { json, raw } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import type { ApiErrorResponse, ErrorCode } from '@chatofy/types';
import { HISTORY_LIMITS } from '@chatofy/types';

/**
 * Answers the SAME `{success:false, error:{code,message}, meta}` envelope
 * `AllExceptionsFilter` emits, for the two refusals below that the filter
 * never sees. Both are raised from plain Express middleware registered via
 * `app.use()`, which runs before Nest's routing exists for this request at
 * all — calling `next(err)` here hands the error to express's own
 * `finalhandler` instead, which answers with an HTML body carrying a stack
 * trace whenever `NODE_ENV !== 'production'`. Matching the shape by hand is
 * the only way these two responses agree with the rest of the API.
 *
 * `requestId` falls back to `'unknown'` for the same reason
 * `AllExceptionsFilter` does: `main.ts` mounts `requestIdMiddleware` AFTER
 * this file's registrations, so a request refused here may not have one yet.
 */
function sendEnvelopeError(
  req: Request,
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
): void {
  const body: ApiErrorResponse = {
    success: false,
    error: { code, message },
    meta: {
      requestId: req.requestId ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
  res.status(status).json(body);
}

/**
 * How long a recording upload may sit with no progress before this route
 * gives up on it and frees the slot it holds.
 *
 * Without this, a trickled or stalled body rides Node's own default
 * `requestTimeout` (300s) before anything releases it — eight such
 * connections lock out every legitimate upload for five minutes, since the
 * slot in {@link limitConcurrentAudioUploads} is held for the request's whole
 * life. 32 MB at any usable connection speed lands well inside 30s, and the
 * client already treats a network failure as retryable, so this costs a
 * genuine uploader nothing.
 */
export const AUDIO_UPLOAD_STALL_TIMEOUT_MS = 30_000;

/**
 * How many recording uploads may have their bytes buffered in memory across
 * the whole process at once, mirroring `turn-concurrency.ts`'s
 * `MAX_CONCURRENT_TURNS_GLOBAL`: a per-request ceiling bounds one upload, and
 * this bounds how many of them can be in flight together, which the per-path
 * ceiling below cannot — it is a `raw()` parser option, and `raw()` has no
 * concept of what else is running.
 *
 * At `HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES` (32 MB) per upload, 8 in
 * flight is 256 MB worst case for this one route — a bound worth having
 * regardless of who is asking, since {@link requireBearerBeforeAudioUpload}
 * only keeps an OUTRIGHT anonymous caller from spending it for free; an
 * authenticated one still counts against it.
 */
export const MAX_CONCURRENT_AUDIO_UPLOADS = 8;

/** In-flight PUT .../audio requests, process-wide. */
let inFlightAudioUploads = 0;

/**
 * Refuses an anonymous recording upload before the raw parser buffers it.
 *
 * A cheap header-presence check ONLY — the token itself is still verified by
 * `JwtAuthGuard`, which runs after this and after the parser below, so a
 * forged header value gains nothing here. What this closes is the gap between
 * the two: without it, an unauthenticated request already has its up-to-32 MB
 * body fully allocated by the time the guard gets a chance to reject it, so
 * authentication was bounding WHO could act on the upload but not who could
 * make the process pay for one.
 */
export function requireBearerBeforeAudioUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'PUT') {
    next();
    return;
  }
  if (!req.headers.authorization) {
    sendEnvelopeError(
      req,
      res,
      HttpStatus.UNAUTHORIZED,
      'UNAUTHORIZED',
      'Unauthorized',
    );
    return;
  }
  next();
}

/**
 * Refuses a recording upload over the process-wide concurrency ceiling,
 * before the raw parser buffers it. Also bounds how long a request that DID
 * get a slot may hold it, so the ceiling cannot be starved by a slow body.
 *
 * The slot is held for the request's whole lifetime, not just parsing: the
 * bytes this bounds stay in memory through the controller and the storage
 * PUT, both of which run after this middleware returns, so releasing early
 * would undercount exactly the part that matters. `res.close` covers a client
 * that disconnects mid-upload; without it an aborted request would hold its
 * slot until the process restarts.
 *
 * `req.setTimeout` only ARMS a timer — unlike the server-level timeout it
 * delegates to, firing it does nothing on its own unless a listener acts on
 * it, so the callback destroying the connection is load-bearing, not
 * decoration. Destroying it fires `close` above exactly as a real client
 * abort would, which is what actually frees the slot; the timer itself is
 * cleared on `finish` so a fast upload's connection is not left with a
 * lingering deadline if it is reused for a later request.
 */
export function limitConcurrentAudioUploads(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'PUT') {
    next();
    return;
  }
  if (inFlightAudioUploads >= MAX_CONCURRENT_AUDIO_UPLOADS) {
    sendEnvelopeError(
      req,
      res,
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Too many recordings are uploading right now — try again shortly',
    );
    return;
  }
  inFlightAudioUploads += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    inFlightAudioUploads -= 1;
  };
  res.once('finish', release);
  res.once('close', release);

  req.setTimeout(AUDIO_UPLOAD_STALL_TIMEOUT_MS, () => req.destroy());
  res.once('finish', () => req.setTimeout(0));

  next();
}

/**
 * Per-path JSON body ceilings, registered BEFORE the app-wide 12mb parser.
 *
 * body-parser marks a request it has already read and every later parser skips
 * it, so whichever runs FIRST decides the ceiling — registering these first is
 * what makes the narrower limit the effective one.
 *
 * A zod `max` cannot do this job. It runs in a Nest pipe, which is downstream of
 * the parser, so by the time it sees anything the full body has been read and
 * JSON.parsed — the exact cost these limits exist to refuse.
 *
 * Lives in its own function rather than inline in `bootstrap` so a test can
 * mount the SAME registration on a module-based app. Otherwise "an oversized
 * body is refused by the parser" would be a claim about a line no suite ever
 * executes.
 */
export function registerNarrowBodyLimits(app: INestApplication): void {
  // 512KB leaves room for base64's ~4/3 expansion over the 256KB byte cap the
  // storage module enforces after decoding.
  app.use('/auth/me/avatar', json({ limit: '512kb' }));

  // Derived from HISTORY_LIMITS.MAX_TOTAL_CHARS and MAX_TURNS, and the margin is
  // thinner than a character count suggests. Measured on this repo's Vietnamese
  // prose, UTF-8 runs ~1.2-1.36 bytes/char, so the 400,000-character ceiling is
  // ~480-545KB of text; the JSON around it adds ~110 bytes of keys, quotes and
  // commas PER TURN, which is another ~440KB at the 4,000-turn maximum. A save
  // that maxes out both lands near 950KB — inside 1mb, but not by much.
  //
  // A transcript never gets there — a ten-minute conversation is a few hundred
  // turns — but a constructed one can exceed it: precomposed Vietnamese vowels
  // (U+1EA0-U+1EF9) cost 3 bytes each, so 400,000 characters of nothing else is
  // ~1.6MB and takes a 413 here rather than the schema's 400. Refusing that at
  // the parser is the point; it is not a body any client sends.
  //
  // The two numbers are ONE decision — raising either without the other either
  // 413s legitimate saves or re-opens the gap this limit exists to close, which
  // is admitting the audio-sized bodies the global limit is sized for.
  app.use('/conversations', json({ limit: '1mb' }));

  // The recording upload, and it does NOT widen the ceiling above.
  //
  // Read that carefully, because this file's own opening paragraph says
  // "whichever runs FIRST decides the ceiling" and a reader will reasonably
  // assume a 32 MB parser mounted near a 1 MB one is a hole. It is not: that rule
  // is about two parsers competing for the SAME body, and these two never see the
  // same body. `body-parser` dispatches on `Content-Type` — `json()` reads only
  // `application/json` and this reads only the two audio types — so a JSON save
  // still meets the 1 MB limit and audio still meets this one, in either
  // registration order.
  //
  // What makes the route possible at all is an ABSENCE: before this line nothing
  // in the app parsed a non-JSON body (`main.ts` registers only `json`, and there
  // is no multipart middleware anywhere), so `req.body` on an audio PUT was
  // `undefined`. This is the parser that reads it.
  //
  // Mounted on the exact param path rather than the `/conversations` prefix, so
  // it cannot touch the transcript routes even by accident. And like the limits
  // above it refuses an oversized body at the PARSER, before the route runs — a
  // zod `max` cannot, because a pipe runs downstream and by then 32 MB is already
  // in memory.
  // The two gates above run BEFORE `raw()`, on the same path, and both
  // no-op for anything but a PUT — the GET on this same path streams a
  // response rather than buffering a request, so neither the auth
  // precheck nor the concurrency ceiling has anything to protect there.
  app.use(
    '/conversations/:conversationId/audio',
    requireBearerBeforeAudioUpload,
    limitConcurrentAudioUploads,
    raw({
      type: ['audio/webm', 'audio/mp4'],
      limit: HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES,
    }),
  );
}
