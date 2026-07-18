import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreateSessionDto,
  SessionRecord,
  SessionStore,
  UpdateSessionDto,
} from '../interfaces/session-store.interface';

/**
 * In-memory session store backed by a plain Map.
 * Default implementation for development and testing.
 * NOT suitable for production (no persistence, no multi-instance sharing).
 * Swap to RedisSessionStore or PrismaSessionStore via the SESSION_STORE token.
 */
@Injectable()
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async createSession(dto: CreateSessionDto): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId: dto.userId,
      status: 'idle',
      startedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    // Shallow copy so callers can never mutate the store's internal record.
    return session ? { ...session } : null;
  }

  async updateSession(
    id: string,
    dto: UpdateSessionDto,
  ): Promise<SessionRecord> {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    // Drop explicitly-undefined dto fields so they cannot clobber stored values.
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    const updated: SessionRecord = { ...session, ...changes };
    this.sessions.set(id, updated);
    return { ...updated };
  }

  async endSession(id: string): Promise<SessionRecord> {
    return this.updateSession(id, { status: 'ended', endedAt: new Date() });
  }
}
