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
import type {
  ConversationPage,
  ConversationStore,
  ListConversationsQuery,
} from '../interfaces/conversation-store.interface';

/** How many times a serialization conflict is re-attempted before it surfaces. */
const MAX_REPLACE_ATTEMPTS = 3;

/**
 * Postgres serialization failures and deadlocks — conflicts a retry can resolve.
 *
 * Prisma's unique violation (`P2002`) is deliberately NOT here. It is not a
 * transient conflict: re-running the identical body hits the identical
 * constraint, so the retry only spends two more SERIALIZABLE transactions and
 * two misleading "serialization conflict" warnings before failing anyway. A body
 * with two turns at one position is refused as a 400 at the boundary
 * (`saveConversationRequestSchema`), and genuinely overlapping saves surface as
 * `P2034` under this isolation level — observed on both the create and the
 * update path — which is retried below.
 */
const RETRYABLE_CODES = new Set(['P2034', '40001', '40P01']);

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
 * a shorter re-save must not leave a stale tail. That replacement runs
 * SERIALIZABLE: under the default READ COMMITTED two overlapping saves of one
 * conversation can both delete and then both insert, and the second hits
 * `@@unique([conversationId, position])` as a P2002 the caller sees as a 500.
 * `PrismaMinutesStore`'s delete-then-create is not a precedent — its child table
 * has no positional unique, so the same interleaving degrades to duplicates
 * rather than an error.
 */
@Injectable()
export class PrismaConversationStore implements ConversationStore {
  private readonly logger = new Logger(PrismaConversationStore.name);

  constructor(private readonly prisma: PrismaService) {}

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
            isolationLevel: 'Serializable',
            // Explicit, because Prisma's inherited default is 5s and the
            // contract admits 4000 turns / 400,000 characters in one save. That
            // worst admissible payload measures ~1.2s here against a local
            // Postgres (delete, then a 4000-row createMany with the trigram
            // index maintained on every row), so 5s is only a few times the
            // best case — a busy server, a cold cache or lock waits can cross
            // it, and a timeout surfaces as P2028, which is not retried and
            // reaches the client as a 500 it reads as "try again". 15s is an
            // order of magnitude over the measured worst case while still
            // bounding how long one save may hold SERIALIZABLE predicate locks.
            timeout: 15_000,
          },
        );
      } catch (err) {
        // Bounded, and logged rather than silent: a retry here means two saves
        // of one conversation really did overlap, and how often that happens is
        // worth seeing rather than hiding.
        if (attempt >= MAX_REPLACE_ATTEMPTS || !isRetryable(err)) throw err;
        this.logger.warn(
          `retrying conversation save after a serialization conflict ` +
            `(attempt ${attempt} of ${MAX_REPLACE_ATTEMPTS}): ${String(err)}`,
        );
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

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
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
