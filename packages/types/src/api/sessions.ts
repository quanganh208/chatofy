// Session API DTOs — request/response shapes for conversation session endpoints
import type { ConversationSession } from '../domain/session.js';

export interface CreateSessionDto {
  preferredLanguage?: 'vi' | 'en';
}

export interface SessionResponseDto {
  session: ConversationSession;
}
