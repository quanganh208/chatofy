import { Injectable, Logger } from '@nestjs/common';
import {
  escapeLikePattern,
  normalizeForSearch,
  type Conversation,
  type ConversationSummary,
  type ConversationTurn,
  type SpeakerRole,
  type TranslationDirection,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isRetryableConflict,
  pause,
  retryDelayMs,
} from '../../../prisma/serialization-retry';
import type {
  ConversationPage,
  ConversationStore,
  ListConversationsQuery,
} from '../interfaces/conversation-store.interface';

/**
 * How many times a transient conflict is re-attempted before it surfaces.
 *
 * Three, and left at three deliberately. While this replace ran SERIALIZABLE the
 * budget was the thing standing between a conflict and a 500, and it was far too
 * small — but raising it was never the repair, because the conflicts came about
 * 2.2 per request and each re-attempt re-ran the whole replace. Now that an
 * owner's saves wait on the lock rather than abort, the ordinary concurrent path
 * reaches this loop zero times (measured: 1,920 concurrent replaces, no
 * cancellation), and what is left for it is a deadlock. The sibling store spends
 * 5 for the same job; the difference is not worth anything at a rate this low,
 * and three re-runs of a transaction that can cost ~1.2s is already a long time
 * to hold a caller.
 */
const MAX_REPLACE_ATTEMPTS = 3;

/**
 * Namespaces the advisory locks this store takes.
 *
 * `pg_advisory_xact_lock` has ONE key space for the whole database, so the
 * two-int form is used rather than the one-bigint form: the first int names this
 * module and the second is the owner's hash. The AI Context library claims 8154
 * for the same purpose, and the two MUST differ — a shared class would make an
 * account's conversation save wait behind its own glossary save for no reason,
 * and would do it invisibly.
 */
const OWNER_LOCK_CLASS = 8155;

/**
 * The upper bound, in milliseconds, on the pause before a re-attempt.
 *
 * Randomised rather than immediate, because two transactions that conflicted
 * once re-run in step and collide again on the identical rows if both retry at
 * the same instant.
 *
 * Nothing on the ordinary concurrent path is expected to reach this now that an
 * owner's saves wait on the lock instead of aborting each other. Counted in
 * Postgres rather than inferred: eight concurrent saves of one conversation,
 * thirty rounds per run, cancelled 537 to 540 transactions per run of 240 under
 * SERIALIZABLE and none with the lock. It is kept for a DEADLOCK, which is the
 * one conflict a single lock cannot rule out, and a retry loop with no jitter is
 * wrong even where it is rarely reached.
 *
 * Small on purpose — this is latency paid by a request already in flight. It is
 * NOT sized against the ~1.2s a worst-admissible replace runs for, because what
 * it now decorrelates is two re-attempts after a deadlock, not two saves racing
 * for the same rows.
 */
const MAX_BACKOFF_MS = 25;

/** The turn columns a read selects — the shape {@link toTurn} maps. */
interface TurnRow {
  position: number;
  speakerRole: string;
  speakerLabel: string | null;
  sourceText: string;
  displayText: string | null;
  targetText: string;
  offsetMs: number | null;
}

/** The parent columns a read selects. */
interface ConversationRow {
  clientId: string;
  direction: string;
  startedAt: Date;
  endedAt: Date;
}

/**
 * The recording columns a DETAIL read selects.
 *
 * Separate from {@link ConversationRow} because the list does not select them:
 * `toSummary` serves both reads, and the summary contract carries no recording
 * fields at all. `audioKey` itself is not here — `toAudio` derives
 * `hasRecording` from `audioDurationMs`, and the key never travels to the
 * caller (see the docblock on `toAudio`), so a detail read has no use for it.
 */
interface AudioRow {
  audioOffsetMs: number | null;
  audioDurationMs: number | null;
}

/**
 * The minutes relation, selected as an id-or-nothing.
 *
 * `select: { id: true }` rather than a boolean the caller passes in: the row's
 * presence IS the answer, so `hasMinutes` cannot drift from what is stored.
 */
type MinutesPresence = { id: string } | null;

/**
 * Postgres-backed conversation history — the durable seam behind
 * CONVERSATION_STORE.
 *
 * Two invariants shape everything here.
 *
 * **Ownership is a filter on every query, never a path parameter.** The URL
 * carries the client-minted id; the row is addressed by the compound
 * `(ownerId, clientId)` unique. There is no method that takes only an id.
 *
 * **A save is a full replacement.** The client owns the id and re-sends the
 * whole conversation, so turns are deleted and re-created rather than merged —
 * a shorter re-save must not leave a stale tail.
 *
 * **Every save takes a lock on its owner first.** Two saves by one account are
 * ordered by that lock rather than decided by an isolation level; see
 * {@link PrismaConversationStore.save} for what was measured and why the
 * replacement no longer runs SERIALIZABLE.
 */
@Injectable()
export class PrismaConversationStore implements ConversationStore {
  private readonly logger = new Logger(PrismaConversationStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or replace one conversation, in full.
   *
   * ## Why the owner is locked, and not left to SERIALIZABLE
   *
   * This replacement used to run SERIALIZABLE and absorb the aborts that
   * produces with a bounded retry. Measured against this schema, the aborts were
   * not an edge: eight concurrent saves of ONE conversation cancelled 537 to 540
   * transactions per run of 240 and answered 149 of those 240 with a 500, and
   * the retry budget was never the cause — every cancelled transaction had
   * already done its whole 200-turn replace before Postgres refused it.
   *
   * The conflict was also NOT confined to a shared row, and that is the finding
   * that rules out fixing it with a lock alone. Eight DIFFERENT conversations,
   * fired together, cancelled 518 to 545 per run of 240 and answered 143 to 155
   * with a 500 — the same rate whether the eight belonged to ONE account or to
   * EIGHT different ones (512 to 540 cancelled, 137 to 152 answering 500). Under
   * SERIALIZABLE this transaction conflicts table-wide, not per owner: it reads
   * and writes the same `ConversationTurn` pages and the same trigram index as
   * every other save, so predicate locks put unrelated accounts in each other's
   * way. A per-owner lock cannot repair that, because the transactions in
   * conflict have no owner in common. Dropping the isolation level is what
   * repairs it, and the lock is what makes dropping it safe.
   *
   * Even the smallest real overlap paid: two concurrent saves cancelled exactly
   * one transaction per pair, in 60 of 60 pairs, on both the same conversation
   * and two different ones — absorbed by the retry into a 200, at roughly double
   * the uncontended latency.
   *
   * ## What the lock has to cover that the isolation level used to
   *
   * The docblock this replaces said SERIALIZABLE was what stopped two
   * overlapping saves of one conversation from both deleting and then both
   * inserting, leaving a transcript that is the union of two edits and was
   * authored by neither. Forcing that interleave on THIS schema — both
   * transactions open and past their probe before either writes — shows the
   * outcome is unreachable at READ COMMITTED even with no lock at all: Prisma's
   * upsert row-locks the parent before the child delete can run, so the second
   * save waits, then deletes the first save's turns and inserts its own. The
   * stored transcript was one operator's in every configuration.
   *
   * What the same interleave DID reach at READ COMMITTED unlocked is a different
   * hazard, and the reason this is not a bare isolation downgrade. Prisma
   * compiles this upsert to a probe SELECT followed by an INSERT or an UPDATE,
   * not to `INSERT ... ON CONFLICT`. Two saves of a conversation that does not
   * exist yet therefore both probe, both find nothing, and both insert — and the
   * loser gets SQLSTATE 23505 on `@@unique([ownerId, clientId])`, which arrives
   * as P2002. P2002 is deliberately not retryable (re-running hits the identical
   * constraint), so that is a 500 on a save that should simply have replaced.
   * SERIALIZABLE turned the same race into a retryable 40001; the lock removes
   * it outright, and the same forced interleave with the lock had both saves
   * commit and stored exactly one operator's turns.
   *
   * `pg_advisory_xact_lock` and never the session-scoped `pg_advisory_lock`:
   * Prisma hands connections back to a pool, so a session lock could be released
   * on a different connection than took it. This one is released by COMMIT or
   * ROLLBACK, on the connection that holds the transaction.
   *
   * The key is `hashtext(ownerId)`, so Postgres does the hashing and it cannot
   * drift from the id. `hashtext` is 32 bits, so two owners can collide; that
   * costs two unrelated accounts serialising their saves, which is a performance
   * question and not a correctness one, because every statement below is still
   * filtered by `ownerId` and a collision grants no access.
   */
  async save(
    ownerId: string,
    conversationId: string,
    conversation: Omit<
      Conversation,
      | 'conversationId'
      | 'turnCount'
      | 'preview'
      | 'hasMinutes'
      // Whether an object exists is written by the audio route, never by the
      // transcript save. A save is a full replacement that re-fires on every
      // rename, so letting it carry these would clear a stored recording the
      // moment someone edited a speaker label. `audioOffsetMs` is not in that
      // category — see below, and see the store interface for why.
      | 'hasRecording'
      | 'audioDurationMs'
    >,
  ): Promise<ConversationSummary> {
    const parent = {
      direction: conversation.direction,
      startedAt: new Date(conversation.startedAt),
      endedAt: new Date(conversation.endedAt),
    };

    // The recording origin, written only when the client actually measured one.
    //
    // Spread into the write rather than listed in it, and that distinction is
    // the whole safety of carrying this column on a save at all: a body without
    // the field — a tab on the previous bundle, any client that does not record
    // — writes NOTHING here, so it cannot null out the value the audio upload
    // stored. A body with one repeats the same number the upload would send.
    const recordingOrigin =
      conversation.audioOffsetMs === null
        ? {}
        : { audioOffsetMs: conversation.audioOffsetMs };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // FIRST, before the upsert's probe read. A lock taken after it would
            // leave open exactly the window it exists to close: the create race
            // is two transactions that both probed an absent row.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OWNER_LOCK_CLASS}::int, hashtext(${ownerId}))`;

            const row = await tx.conversation.upsert({
              where: {
                ownerId_clientId: { ownerId, clientId: conversationId },
              },
              create: {
                ownerId,
                clientId: conversationId,
                ...parent,
                ...recordingOrigin,
              },
              // `parent` is direction/startedAt/endedAt and MUST stay exactly
              // those three. This is load-bearing and invisible from the line:
              // the save re-fires on every post-end transcript edit, so anything
              // listed here is rewritten on a rename. `audioKey` and
              // `audioDurationMs` survive a rename precisely because they are not
              // in this object, and adding either would silently clear a stored
              // recording when someone renamed a speaker.
              //
              // `recordingOrigin` is empty unless the body carried a measurement,
              // so the same protection holds for `audioOffsetMs`: the rename that
              // would clear it writes no key for it, and a rename that does carry
              // it writes the value it already had.
              update: { ...parent, ...recordingOrigin },
              select: { id: true, minutes: { select: { id: true } } },
            });

            await tx.conversationTurn.deleteMany({
              where: { conversationId: row.id },
            });
            await tx.conversationTurn.createMany({
              data: conversation.turns.map((turn) => ({
                conversationId: row.id,
                position: turn.position,
                speakerRole: turn.speakerRole,
                speakerLabel: turn.speakerLabel,
                sourceText: turn.sourceText,
                displayText: turn.displayText,
                targetText: turn.targetText,
                searchText: searchTextFor(turn),
                offsetMs: turn.offsetMs,
              })),
            });

            return toSummary(
              { clientId: conversationId, ...parent },
              conversation.turns.length,
              previewOf(conversation.turns),
              row.minutes,
            );
          },
          {
            // READ COMMITTED, and the lock above is what pays for it. The level
            // is not a tuning choice here: SERIALIZABLE conflicts table-wide on
            // this transaction, so it cancels saves that share no row and no
            // owner — see the docblock for the counts. What the lock still owes
            // is the per-owner ordering that level was providing, and it is
            // strictly stronger at it: an owner's saves wait rather than abort.
            isolationLevel: 'ReadCommitted',
            // Explicit, because Prisma's inherited default is 5s and the
            // contract admits 4000 turns / 400,000 characters in one save. That
            // worst admissible payload measures ~0.6–1.2s here against a local
            // Postgres (delete, then a 4000-row createMany with the trigram
            // index maintained on every row), so 5s is only a few times the
            // best case — a busy server, a cold cache or lock waits can cross
            // it, and a timeout surfaces as P2028, which is not retried and
            // reaches the client as a 500 it reads as "try again".
            //
            // The WAIT on the owner's lock is inside this budget, because the
            // lock is taken after BEGIN. That is the cost of ordering rather
            // than aborting, and 15s is what bounds it: an account would have to
            // have a dozen worst-case replaces of its own in flight at once
            // before the queue behind the lock could reach it.
            timeout: 15_000,
          },
        );
      } catch (err) {
        // Bounded, and logged rather than silent: with the lock in place a retry
        // here is no longer the ordinary concurrent path but a deadlock, which
        // is rare enough that how often it happens is worth seeing. Which
        // failures qualify is the shared rule's to say — notably not `P2002`,
        // which under this schema would mean two turns at one position, and a
        // body carrying that is already refused as a 400 at the boundary
        // (`saveConversationRequestSchema`).
        if (attempt >= MAX_REPLACE_ATTEMPTS || !isRetryableConflict(err)) {
          throw err;
        }
        this.logger.warn(
          `retrying conversation save after a transient conflict ` +
            `(attempt ${attempt} of ${MAX_REPLACE_ATTEMPTS}): ${String(err)}`,
        );
        await pause(retryDelayMs(attempt, MAX_BACKOFF_MS));
      }
    }
  }

  async get(
    ownerId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { ownerId_clientId: { ownerId, clientId: conversationId } },
      select: {
        clientId: true,
        direction: true,
        startedAt: true,
        endedAt: true,
        audioOffsetMs: true,
        audioDurationMs: true,
        minutes: { select: { id: true } },
        turns: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            speakerRole: true,
            speakerLabel: true,
            sourceText: true,
            displayText: true,
            targetText: true,
            offsetMs: true,
          },
        },
      },
    });
    if (!row) return null;

    const turns = row.turns.map(toTurn);
    return {
      ...toSummary(row, turns.length, previewOf(turns), row.minutes),
      turns,
      ...toAudio(row),
    };
  }

  async list(
    ownerId: string,
    query: ListConversationsQuery,
  ): Promise<ConversationPage> {
    // One row past the page: its presence is what says another page exists,
    // without a second count query nothing else needs.
    const rows = await this.prisma.conversation.findMany({
      where: {
        // ALWAYS first, and never optional. Search narrows what an owner can
        // see; it is not a second route into someone else's history, so a term
        // that matches another user's conversation yields an empty list rather
        // than theirs.
        ownerId,
        ...searchFilter(query.q),
      },
      // `createdAt` is server-stamped, so it is the only ordering the API can
      // vouch for; `id` breaks ties so the keyset cursor is deterministic when
      // two conversations land in the same millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        clientId: true,
        direction: true,
        startedAt: true,
        endedAt: true,
        minutes: { select: { id: true } },
        _count: { select: { turns: true } },
        // Without the explicit orderBy Prisma returns an ARBITRARY row for a
        // nested take, so the preview would not be the first line.
        turns: {
          take: 1,
          orderBy: { position: 'asc' },
          select: { sourceText: true, displayText: true },
        },
      },
    });

    const page = rows.slice(0, query.limit);
    return {
      conversations: page.map((row) =>
        toSummary(row, row._count.turns, previewOf(row.turns), row.minutes),
      ),
      // The cursor IS the row's server cuid, deliberately: it is the value
      // `orderBy: [{createdAt}, {id}]` breaks ties on, so nothing else
      // identifies the page boundary. It is safe to hand out because it is only
      // ever read back as `cursor`, where it selects a starting point within a
      // list already filtered by `ownerId` above — and it can never be replayed
      // as a conversation id, since every id-bearing route validates `z.uuid()`
      // and a cuid is not one.
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findAudioKey(
    ownerId: string,
    conversationId: string,
  ): Promise<string | null> {
    // Owner-scoped like everything else here, so a foreign id reads as "no key"
    // rather than handing back someone else's object name.
    const row = await this.prisma.conversation.findUnique({
      where: { ownerId_clientId: { ownerId, clientId: conversationId } },
      select: { audioKey: true },
    });
    return row?.audioKey ?? null;
  }

  async claimAudioKey(
    ownerId: string,
    conversationId: string,
    candidate: string,
  ): Promise<string | null> {
    // The conditional update IS the compare-and-swap: it only writes a row
    // whose audioKey is still null, so of two concurrent callers at most one
    // can move count above zero. updateMany rather than update for the same
    // reason as below — it reports a count instead of throwing when the
    // caller owns no such row.
    const { count } = await this.prisma.conversation.updateMany({
      where: { ownerId, clientId: conversationId, audioKey: null },
      data: { audioKey: candidate },
    });
    if (count > 0) return candidate;

    // Either another call already won the claim, or the caller owns no such
    // row at all — this is the only way to tell the two apart, and a
    // concurrent loser reading the winner's key back here is what makes both
    // requests write the SAME object instead of stranding one of them.
    const row = await this.prisma.conversation.findUnique({
      where: { ownerId_clientId: { ownerId, clientId: conversationId } },
      select: { audioKey: true },
    });
    return row?.audioKey ?? null;
  }

  async setAudio(
    ownerId: string,
    conversationId: string,
    audio: { key: string; offsetMs: number; durationMs: number },
  ): Promise<boolean> {
    // updateMany, not update: it takes the compound owner filter directly and
    // reports zero instead of throwing when the caller owns no such row, which
    // is what lets the service answer a foreign id exactly like an absent one.
    const { count } = await this.prisma.conversation.updateMany({
      where: { ownerId, clientId: conversationId },
      data: {
        audioKey: audio.key,
        audioOffsetMs: audio.offsetMs,
        audioDurationMs: audio.durationMs,
      },
    });
    return count > 0;
  }

  async removeReturningAudioKey(
    ownerId: string,
    conversationId: string,
  ): Promise<{ removed: boolean; audioKey: string | null }> {
    try {
      // A single DELETE ... RETURNING, not a find followed by a delete: two
      // statements would leave a window where a concurrent upload's key claim
      // and PUT land between them, and the value worth reporting is whatever
      // the row's audioKey actually was at the instant it stopped existing —
      // a snapshot read taken earlier could already be stale by then. `delete`
      // (singular) compiles to exactly that one statement and returns the
      // selected columns from the deleted row; `deleteMany` cannot, which is
      // why this is the one place on this store that uses it over the
      // owner-filtered plural the rest of the file prefers.
      const row = await this.prisma.conversation.delete({
        where: { ownerId_clientId: { ownerId, clientId: conversationId } },
        select: { audioKey: true },
      });
      return { removed: true, audioKey: row.audioKey };
    } catch (err) {
      if (isRecordNotFound(err)) return { removed: false, audioKey: null };
      throw err;
    }
  }
}

function toTurn(row: TurnRow): ConversationTurn {
  return {
    position: row.position,
    speakerRole: row.speakerRole as SpeakerRole,
    speakerLabel: row.speakerLabel,
    sourceText: row.sourceText,
    displayText: row.displayText,
    targetText: row.targetText,
    offsetMs: row.offsetMs,
  };
}

/**
 * The detail contract's recording fields.
 *
 * `hasRecording` is derived from the stored duration — see the comment on the
 * field itself for why not from the key — and the key is DROPPED here: the
 * contract carries whether a recording exists, never where it lives. The route
 * is the only way to the bytes, so publishing the key would make the storage
 * layout a public interface for no caller that needs it.
 *
 * The two numbers travel because the screen cannot place a timestamp without
 * them: `audioOffsetMs` converts a turn's conversation-relative offset into a
 * media position, and `audioDurationMs` is the only real total a scrubber has,
 * since `MediaRecorder` writes no Duration into the WebM header.
 */
function toAudio(row: AudioRow): {
  hasRecording: boolean;
  audioOffsetMs: number | null;
  audioDurationMs: number | null;
} {
  return {
    // Not `audioKey !== null`. `claimAudioKey` sets that column BEFORE a
    // single byte is written, atomically, so a conversation read between the
    // claim and a successful upload would otherwise say it has a recording it
    // does not yet have — permanently so if the upload then fails and nothing
    // ever clears the claimed key. `audioDurationMs` is written only by
    // `setAudio`, once the PUT it follows has already succeeded.
    hasRecording: row.audioDurationMs !== null,
    audioOffsetMs: row.audioOffsetMs,
    audioDurationMs: row.audioDurationMs,
  };
}

/**
 * The list card's shape.
 *
 * Never exposes `ownerId`, and the conversation it names is named by the CLIENT
 * id — the server cuid is not part of any conversation identity the API hands
 * out. (The page cursor above is a separate value with its own reason; see the
 * comment on it.)
 */
function toSummary(
  row: ConversationRow,
  turnCount: number,
  preview: string,
  minutes: MinutesPresence,
): ConversationSummary {
  return {
    conversationId: row.clientId,
    direction: row.direction as TranslationDirection,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    turnCount,
    preview,
    hasMinutes: minutes !== null,
  };
}

/** The first block's text, as the user read it. */
function previewOf(
  turns: readonly { sourceText: string; displayText: string | null }[],
): string {
  const first = turns[0];
  return first ? (first.displayText ?? first.sourceText) : '';
}

/**
 * The searchable form of one turn: everything a reader could look for, folded.
 *
 * All three texts, because a search must match what the reader SAW —
 * `displayText` carries the repaired rendering, so folding `sourceText` alone
 * would miss any phrase repaired before it reached the screen — and also what the
 * recognizer produced, so the raw line stays findable too.
 */
function searchTextFor(turn: ConversationTurn): string {
  return normalizeForSearch(
    [turn.displayText ?? '', turn.sourceText, turn.targetText].join(' '),
  );
}

/**
 * Narrow to conversations whose normalized text holds the term.
 *
 * The term goes through the SAME fold the stored column did, which is what makes
 * the match diacritic-insensitive in both directions: "hop" finds "họp" and
 * "họp" finds "hop". Folding only one side would work in only one.
 *
 * No `mode: 'insensitive'`. Both sides are already lower case, so a plain `LIKE`
 * is correct here — and unlike `ILIKE` it can use the trigram index, which is the
 * whole reason the column exists. It also takes case folding off the database's
 * collation and makes it a property of the data.
 *
 * The term is escaped rather than passed through. Prisma's `contains` does not
 * escape LIKE metacharacters, so `%` would be a wildcard and a lone backslash
 * would leave a dangling escape that Postgres rejects with SQLSTATE 22025 — an
 * opaque 500 from one character. See `escapeLikePattern`.
 */
function searchFilter(q: string | undefined) {
  if (!q) return {};
  const contains = escapeLikePattern(normalizeForSearch(q));
  return { turns: { some: { searchText: { contains } } } };
}

/**
 * Prisma's "record to delete/update does not exist" refusal — what `delete`
 * and `update` (singular) throw instead of the zero-count `deleteMany` and
 * `updateMany` report. Matched structurally on the code rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`, for the same reason
 * `prisma-user.repository.ts` gives: it is one field, and importing the
 * generated client's error class here would tie this file to a build artifact
 * `prisma:generate` has to have produced before it type-checks.
 */
function isRecordNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'P2025';
}
