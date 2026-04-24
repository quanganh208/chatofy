// Transcript segment domain types
import type { SpeakerRole } from './session.js';

export type TranslationDirection = 'vi_to_en' | 'en_to_vi';

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speakerRole: SpeakerRole;
  direction: TranslationDirection;
  sourceText: string;
  targetText: string;
  audioUrl: string | null;
  createdAt: string;
}
