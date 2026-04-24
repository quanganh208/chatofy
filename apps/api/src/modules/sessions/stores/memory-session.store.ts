import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CreateSessionInput,
  SessionRecord,
  SessionStore,
  UpdateSessionInput,
} from '../interfaces/session-store.interface.js';

/**
 * In-memory session store — for development and testing only.
 * Data is lost on restart. Do NOT use in production.
 * Swap for RedisSessionStore or PrismaSessionStore by rebinding SESSION_STORE token.
 */
@Injectable()
export class MemorySessionStore implements SessionStore {
  /** In-memory map keyed by session ID. */
  private readonly sessions = new Map<string, SessionRecord>();

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      status: 'idle',
      startedAt: new Date(),
      endedAt: null,
      meta: input.meta ?? {},
    };
    this.sessions.set(record.id, record);
    return record;
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async updateSession(id: string, input: UpdateSessionInput): Promise<SessionRecord> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new NotFoundException(`Session ${id} not found`);
    }
    const updated: SessionRecord = {
      ...existing,
      status: input.status ?? existing.status,
      meta: input.meta != null ? { ...existing.meta, ...input.meta } : existing.meta,
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async endSession(id: string): Promise<SessionRecord> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new NotFoundException(`Session ${id} not found`);
    }
    const ended: SessionRecord = {
      ...existing,
      status: 'ended',
      endedAt: new Date(),
    };
    this.sessions.set(id, ended);
    return ended;
  }
}
