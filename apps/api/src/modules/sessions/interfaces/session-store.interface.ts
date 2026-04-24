/** DI injection token for the session store. */
export const SESSION_STORE = Symbol('SESSION_STORE');

/** Lifecycle states a conversation session can be in. */
export type SessionStatus = 'idle' | 'active' | 'ended';

/** A single conversation session record. */
export interface SessionRecord {
  id: string;
  userId: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt?: Date;
}

/** Fields required to create a new session. */
export interface CreateSessionDto {
  userId: string;
}

/** Fields that can be mutated on an existing session. */
export interface UpdateSessionDto {
  status?: SessionStatus;
  endedAt?: Date;
}

/**
 * Backend-agnostic session store interface.
 * Default impl: MemorySessionStore (dev/test).
 * Swap to RedisSessionStore or PrismaSessionStore without changing consumers.
 */
export interface SessionStore {
  createSession(dto: CreateSessionDto): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, dto: UpdateSessionDto): Promise<SessionRecord>;
  endSession(id: string): Promise<SessionRecord>;
}
