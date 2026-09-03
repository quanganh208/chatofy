import { json } from 'express';
import type { INestApplication } from '@nestjs/common';

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
}
