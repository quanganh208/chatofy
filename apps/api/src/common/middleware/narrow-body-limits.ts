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

  // Derived from HISTORY_LIMITS.MAX_TOTAL_CHARS: 400,000 characters at ~1.6
  // bytes/char worst case in Vietnamese UTF-8 is ~640KB, so 1mb leaves headroom
  // without admitting the audio-sized bodies the global limit exists for. The
  // two numbers are ONE decision — raising either without the other either 413s
  // legitimate saves or re-opens the gap.
  app.use('/conversations', json({ limit: '1mb' }));
}
