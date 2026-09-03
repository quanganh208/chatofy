// Conversation history HTTP contracts — schema-first.
//
// The write is a PUT because the client owns the id and the body is a complete,
// idempotent replacement of the conversation: re-saving after a roster edit
// replaces rather than duplicating. The id is minted by the browser, so it is
// never a global key — uniqueness is `(ownerId, clientId)` — and a guessed id
// resolves to nothing rather than to a 409 that would reveal it exists.
import { z } from 'zod';
import { conversationSchema, conversationSummarySchema } from '../domain/conversation.js';
import { speakerRoleSchema } from '../domain/session.js';
import { translationDirectionSchema } from '../domain/transcript.js';

/**
 * Ceilings on a stored conversation.
 *
 * `MAX_TOTAL_CHARS` is the STORAGE ceiling and is deliberately its own number,
 * not derived from `MINUTES_LIMITS.MAX_TOTAL_CHARS`. Coupling them would mean a
 * model swap that raises the prompt budget silently doubles the Postgres row
 * cap. The two bound different things: a conversation past this cannot be
 * SAVED, while one past the minutes cap saves and is readable and simply cannot
 * be summarized.
 *
 * 400,000 characters is ~520–640 KB of Vietnamese UTF-8, which is what sets the
 * 1 MB express parser limit registered for `/conversations` in `main.ts` — the
 * two are one decision and move together.
 */
export const HISTORY_LIMITS = {
  MAX_TURNS: 4_000,
  /** Per text field. */
  MAX_TURN_CHARS: 4_000,
  MAX_SPEAKER_LABEL_CHARS: 120,
  MAX_TOTAL_CHARS: 400_000,
  DEFAULT_PAGE_SIZE: 30,
  MAX_PAGE_SIZE: 100,
  /**
   * How far a client-reported timestamp may sit from the server's own clock
   * before the save is refused. Wide enough to absorb a badly-set machine and a
   * long meeting; narrow enough that a card cannot render a duration measured in
   * years.
   */
  MAX_CLOCK_SKEW_MS: 24 * 60 * 60 * 1000,
  MAX_DURATION_MS: 24 * 60 * 60 * 1000,
} as const;

/** One displayed block as the client submits it. */
export const saveConversationTurnSchema = z.object({
  position: z.number().int().min(0),
  speakerRole: speakerRoleSchema,
  speakerLabel: z.string().min(1).max(HISTORY_LIMITS.MAX_SPEAKER_LABEL_CHARS).nullable(),
  sourceText: z.string().max(HISTORY_LIMITS.MAX_TURN_CHARS),
  displayText: z.string().max(HISTORY_LIMITS.MAX_TURN_CHARS).nullable(),
  targetText: z.string().max(HISTORY_LIMITS.MAX_TURN_CHARS),
});
export type SaveConversationTurn = z.infer<typeof saveConversationTurnSchema>;

/**
 * PUT /conversations/:conversationId body.
 *
 * The first refine below is the only bound on the WHOLE payload that runs in
 * the application: the per-field caps each pass while a thousand of them
 * together do not. It still runs downstream of the parser, which is why
 * `main.ts` registers a byte limit for this path as well — a zod `max` cannot
 * refuse a body that has already been read and parsed.
 */
export const saveConversationRequestSchema = z
  .object({
    direction: translationDirectionSchema,
    /** ISO-8601, client clock. */
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    turns: z.array(saveConversationTurnSchema).min(1).max(HISTORY_LIMITS.MAX_TURNS),
  })
  .refine(
    (body) =>
      body.turns.reduce(
        (sum, t) =>
          sum +
          (t.speakerLabel?.length ?? 0) +
          t.sourceText.length +
          (t.displayText?.length ?? 0) +
          t.targetText.length,
        0,
      ) <= HISTORY_LIMITS.MAX_TOTAL_CHARS,
    {
      path: ['turns'],
      message: `conversation exceeds ${HISTORY_LIMITS.MAX_TOTAL_CHARS} characters`,
    },
  )
  // `position` is the row key: the store writes turns under
  // `@@unique([conversationId, position])`, so two turns sharing one is a body
  // Postgres can never accept. Refusing it HERE makes it a 400 the client can
  // act on; reaching the store instead produces a unique violation, which is
  // not retryable and surfaces as a 500 — a status the client reads as "try
  // again" for a body that cannot ever succeed.
  .refine((body) => new Set(body.turns.map((t) => t.position)).size === body.turns.length, {
    path: ['turns'],
    message: 'two turns share the same position',
  })
  .refine((body) => Date.parse(body.endedAt) >= Date.parse(body.startedAt), {
    path: ['endedAt'],
    message: 'endedAt is earlier than startedAt',
  })
  .refine(
    (body) =>
      Date.parse(body.endedAt) - Date.parse(body.startedAt) <= HISTORY_LIMITS.MAX_DURATION_MS,
    {
      path: ['endedAt'],
      message: 'the conversation is implausibly long',
    },
  )
  // A browser clock can be wrong, and the duration on a history card is
  // rendered from these two values. Bounding them at the boundary is what stops
  // a lying clock from putting a conversation in 1970 or in the next century.
  .refine(
    (body) =>
      [body.startedAt, body.endedAt].every(
        (iso) => Math.abs(Date.now() - Date.parse(iso)) <= HISTORY_LIMITS.MAX_CLOCK_SKEW_MS,
      ),
    {
      path: ['startedAt'],
      message: 'the reported timestamps are too far from the server clock',
    },
  );
export type SaveConversationRequest = z.infer<typeof saveConversationRequestSchema>;

/**
 * Bounds on a history search term.
 *
 * `MIN_CHARS` is 2 rather than 1, and neither value reaches the trigram index:
 * a `LIKE '%ab%'` under three characters contains no full trigram, so Postgres
 * scans either way. What the floor buys is the SIZE of that scan's result. A
 * single character matches a large fraction of any transcript, so a
 * one-character term returns most of the caller's history and answers a
 * question nobody asked; two characters is already selective enough to be a
 * search rather than a dump, and it keeps two-letter words ("ừ", "ok") askable.
 * `MAX_CHARS` bounds the pattern that reaches `LIKE`.
 */
export const SEARCH_LIMITS = {
  MIN_CHARS: 2,
  MAX_CHARS: 200,
} as const;

/** `?q=` — trimmed, bounded, and never optional-but-empty. */
export const conversationSearchQuerySchema = z
  .string()
  .trim()
  .min(SEARCH_LIMITS.MIN_CHARS)
  .max(SEARCH_LIMITS.MAX_CHARS);

/**
 * Fold a string to the form history search matches on: no diacritics, lower case.
 *
 * This is what makes "hop" find "họp". It is applied to BOTH sides — the stored
 * `ConversationTurn.searchText` is written through it, and a query term is folded
 * the same way before it is matched — so the two can never disagree about what
 * counts as the same letter. That is the reason it lives in the shared contract
 * package rather than beside either caller.
 *
 * Three steps, and each handles a case the others do not:
 *
 * 1. NFD decomposition splits a precomposed letter into its base plus combining
 *    marks, which the following `replace` then strips. This is what handles the
 *    whole Vietnamese vowel set (`ế`, `ộ`, `ữ`) without a lookup table.
 * 2. `đ`/`Đ` is NOT a combining form — it is a distinct letter with a stroke, so
 *    NFD leaves it untouched and it needs its own mapping. Postgres `unaccent`
 *    maps it the same way, which is what lets the migration's one-time backfill
 *    of existing rows agree with everything written afterwards.
 * 3. Lower-casing LAST, after the marks are gone, and in JavaScript rather than
 *    through SQL `ILIKE`. Case folding through `ILIKE` depends on the database's
 *    collation; doing it here makes it a property of the data instead.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase();
}

/**
 * Escape the LIKE metacharacters in a search term.
 *
 * Prisma's `contains` does NOT escape them, so `%` and `_` from a user would be
 * wildcards. Escaping only those two is not enough, and the gap is a crash
 * rather than a subtlety: Postgres `LIKE` uses backslash as its default escape
 * character, so rewriting `%`→`\%` and `_`→`\_` without first rewriting
 * `\`→`\\` leaves a DANGLING escape for `q = "\"`. Postgres then raises
 * SQLSTATE 22025 and the API's exception filter turns it into an opaque 500 — a
 * one-character self-service crash on an authenticated route.
 *
 * Order is therefore load-bearing: backslash first, then the wildcards.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Cursor paging lives in `data`, not `meta.pagination`.
 *
 * `TransformInterceptor` emits only `{requestId, timestamp}` and never populates
 * `pagination`, and `paginationSchema` is page-based (page/total/totalPages)
 * while this is keyset — there is no total to report without a second count
 * query nothing needs.
 */
export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  /** Pass back as `?cursor=` for the next page; null when this is the last. */
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const conversationResponseSchema = z.object({
  conversation: conversationSchema,
});
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

/** PUT answers with the summary it stored — the list card's shape, no turns. */
export const conversationSummaryResponseSchema = z.object({
  conversation: conversationSummarySchema,
});
export type ConversationSummaryResponse = z.infer<typeof conversationSummaryResponseSchema>;
