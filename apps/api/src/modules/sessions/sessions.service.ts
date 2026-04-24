import { Inject, Injectable } from '@nestjs/common';
import {
  SESSION_STORE,
  type CreateSessionInput,
  type SessionRecord,
  type SessionStore,
  type UpdateSessionInput,
} from './interfaces/session-store.interface.js';

/**
 * SessionsService — thin facade over SESSION_STORE.
 * Orchestration logic (e.g. broadcasting end-of-session events) will go here.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  createSession(input: CreateSessionInput): Promise<SessionRecord> {
    return this.store.createSession(input);
  }

  getSession(id: string): Promise<SessionRecord | null> {
    return this.store.getSession(id);
  }

  updateSession(id: string, input: UpdateSessionInput): Promise<SessionRecord> {
    return this.store.updateSession(id, input);
  }

  endSession(id: string): Promise<SessionRecord> {
    return this.store.endSession(id);
  }
}
