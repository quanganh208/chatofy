/**
 * Backend-agnostic conversation session store contract.
 * Default impl: MemorySessionStore (dev only).
 * Production: swap SESSION_STORE token binding to a Redis or Postgres-backed store.
 */

export const SESSION_STORE = Symbol('SESSION_STORE');

export type SessionStatus = 'idle' | 'active' | 'ended';

export interface SessionRecord {
  id: string;
  userId: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  /** Arbitrary metadata — language pair, device info, etc. */
  meta: Record<string, unknown>;
}

export interface CreateSessionInput {
  userId: string;
  meta?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  status?: SessionStatus;
  meta?: Record<string, unknown>;
}

export interface SessionStore {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, input: UpdateSessionInput): Promise<SessionRecord>;
  endSession(id: string): Promise<SessionRecord>;
}
