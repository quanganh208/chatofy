// Conversation session domain types

export type SpeakerRole = 'speaker_a' | 'speaker_b';

export type SessionStatus = 'idle' | 'active' | 'ended';

export interface ConversationSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
}
