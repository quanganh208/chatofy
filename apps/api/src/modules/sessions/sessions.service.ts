import { Inject, Injectable } from '@nestjs/common';
import {
  CreateSessionDto,
  SessionRecord,
  SessionStore,
  SESSION_STORE,
  UpdateSessionDto,
} from './interfaces/session-store.interface';

/**
 * Sessions service — thin facade over SessionStore.
 * Place domain rules (max active sessions, TTL enforcement) here, not in the store.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  createSession(dto: CreateSessionDto): Promise<SessionRecord> {
    return this.store.createSession(dto);
  }

  getSession(id: string): Promise<SessionRecord | null> {
    return this.store.getSession(id);
  }

  updateSession(id: string, dto: UpdateSessionDto): Promise<SessionRecord> {
    return this.store.updateSession(id, dto);
  }

  endSession(id: string): Promise<SessionRecord> {
    return this.store.endSession(id);
  }
}
