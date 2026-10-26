import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * The slice of PrismaService the conference module reads and writes, kept in
 * memory.
 *
 * Lives under `test/` like the other in-memory doubles. It understands exactly
 * the query shapes `ConferenceService`, `ConferencePersistenceService` and
 * `ConferenceMinutesService` issue — no more — and enforces the same rules Postgres would for them: the
 * `(conferenceId, userId)` unique key, the foreign key from a participant to
 * its conference, and owner-or-participant visibility. A double that skipped
 * those would let the fast suites pass with an access bug the db suite alone
 * could catch.
 */

export interface ConferenceRow {
  id: string;
  ownerId: string;
  title: string | null;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParticipantRow {
  id: string;
  conferenceId: string;
  userId: string;
  displayName: string | null;
  sourceLanguage: string;
  status: string;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface TurnRow {
  id: string;
  conferenceId: string;
  participantId: string;
  sourceLanguage: string;
  sourceText: string;
  searchText: string | null;
  translations: unknown;
}

export interface MessageRow {
  id: string;
  conferenceId: string;
  participantId: string;
  text: string;
  sourceLanguage: string;
}

/** A collision-free id that passes `z.cuid()`, like Prisma's `@default(cuid())`. */
export function fakeCuid(): string {
  return `c${randomBytes(12).toString('hex')}`;
}

/** `{ OR: [{ ownerId }, { participants: { some: { userId } } }] }` → userId. */
interface VisibleToWhere {
  id?: string;
  OR?: [{ ownerId: string }, { participants: { some: { userId: string } } }];
}

type Picked<T> = Partial<Record<keyof T, true>>;

function pick<T extends object>(row: T, select?: Picked<T>): Partial<T> {
  if (!select) return { ...row };
  const out: Partial<T> = {};
  for (const key of Object.keys(select) as (keyof T)[]) out[key] = row[key];
  return out;
}

export class InMemoryConferencePrisma {
  readonly conferences = new Map<string, ConferenceRow>();
  readonly participants: ParticipantRow[] = [];
  readonly turns: TurnRow[] = [];
  readonly messages: MessageRow[] = [];

  /** Health check probe used by AppModule's readiness route. */
  $queryRaw = () => Promise.resolve([{ '?column?': 1 }]);

  $transaction = <T extends readonly unknown[]>(ops: T) => Promise.all(ops);

  conference = {
    create: ({
      data,
    }: {
      data: { ownerId: string; title: string | null; status: string };
    }) => {
      const now = new Date();
      const row: ConferenceRow = {
        id: fakeCuid(),
        startedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.conferences.set(row.id, row);
      return Promise.resolve({ ...row });
    },

    findUnique: ({
      where,
      select,
    }: {
      where: { id: string };
      select?: Picked<ConferenceRow>;
    }) => {
      const row = this.conferences.get(where.id);
      return Promise.resolve(row ? pick(row, select) : null);
    },

    findFirst: ({ where }: { where: VisibleToWhere }) => {
      const row = this.visible(where).find((c) => c.id === where.id);
      if (!row) return Promise.resolve(null);
      const participants = this.participants.filter(
        (p) => p.conferenceId === row.id,
      );
      const turns = this.turns.filter((t) => t.conferenceId === row.id);
      return Promise.resolve({
        ...row,
        participants: participants.map((p) => ({ ...p })),
        _count: { turns: turns.length },
      });
    },

    findMany: ({
      where,
      skip,
      take,
    }: {
      where: VisibleToWhere;
      skip: number;
      take: number;
    }) =>
      Promise.resolve(
        this.visible(where)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, skip + take)
          .map((c) => ({ ...c })),
      ),

    count: ({ where }: { where: VisibleToWhere }) =>
      Promise.resolve(this.visible(where).length),

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<ConferenceRow>;
    }) => {
      const row = this.conferences.get(where.id);
      if (!row) return Promise.reject(new Error('Record to update not found'));
      Object.assign(row, data, { updatedAt: new Date() });
      return Promise.resolve({ ...row });
    },

    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Partial<ConferenceRow>;
    }) => {
      const row = this.conferences.get(where.id);
      if (!row || (where.status !== undefined && row.status !== where.status)) {
        return Promise.resolve({ count: 0 });
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return Promise.resolve({ count: 1 });
    },
  };

  conferenceParticipant = {
    upsert: ({
      where,
      create,
      update,
    }: {
      where: { conferenceId_userId: { conferenceId: string; userId: string } };
      create: Omit<ParticipantRow, 'id' | 'joinedAt' | 'leftAt'>;
      update: Partial<ParticipantRow>;
    }) => {
      const { conferenceId, userId } = where.conferenceId_userId;
      if (!this.conferences.has(conferenceId)) {
        return Promise.reject(new Error('Foreign key constraint violated'));
      }
      const existing = this.participants.find(
        (p) => p.conferenceId === conferenceId && p.userId === userId,
      );
      if (existing) {
        Object.assign(existing, update);
        return Promise.resolve({ id: existing.id });
      }
      const row: ParticipantRow = {
        id: fakeCuid(),
        joinedAt: new Date(),
        leftAt: null,
        ...create,
      };
      this.participants.push(row);
      return Promise.resolve({ id: row.id });
    },

    updateMany: ({
      where,
      data,
    }: {
      where: { conferenceId: string; userId: string };
      data: Partial<ParticipantRow>;
    }) => {
      const rows = this.participants.filter(
        (p) =>
          p.conferenceId === where.conferenceId &&
          p.userId === where.userId &&
          p.status !== 'left',
      );
      rows.forEach((row) => Object.assign(row, data));
      return Promise.resolve({ count: rows.length });
    },
  };

  conferenceTurn = {
    create: ({ data }: { data: Omit<TurnRow, 'id'> }) => {
      const row = { id: fakeCuid(), ...data };
      this.turns.push(row);
      return Promise.resolve(row);
    },

    /**
     * The minutes read: a room's turns in creation order, each with its
     * speaker's display name. Insertion order stands in for `createdAt`.
     */
    findMany: ({ where }: { where: { conferenceId: string } }) =>
      Promise.resolve(
        this.turns
          .filter((t) => t.conferenceId === where.conferenceId)
          .map((t) => ({
            sourceText: t.sourceText,
            participant: {
              displayName:
                this.participants.find((p) => p.id === t.participantId)
                  ?.displayName ?? null,
            },
          })),
      ),
  };

  conferenceMessage = {
    create: ({ data }: { data: Omit<MessageRow, 'id'> }) => {
      const row = { id: fakeCuid(), ...data };
      this.messages.push(row);
      return Promise.resolve(row);
    },
  };

  /** Seed a conference row directly, e.g. one already ended. */
  seed(row: Partial<ConferenceRow> & { ownerId: string }): ConferenceRow {
    const now = new Date();
    const full: ConferenceRow = {
      id: fakeCuid(),
      title: null,
      status: 'waiting',
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      ...row,
    };
    this.conferences.set(full.id, full);
    return full;
  }

  asPrismaService(): PrismaService {
    // A structural double: only the delegates above exist, and the conference
    // module touches nothing else.
    return this as unknown as PrismaService;
  }

  private visible(where: VisibleToWhere): ConferenceRow[] {
    const ownerId = where.OR?.[0].ownerId;
    const userId = where.OR?.[1].participants.some.userId;
    return [...this.conferences.values()].filter(
      (c) =>
        where.OR === undefined ||
        c.ownerId === ownerId ||
        this.participants.some(
          (p) => p.conferenceId === c.id && p.userId === userId,
        ),
    );
  }
}
