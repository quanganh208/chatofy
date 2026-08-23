// Domain barrel — named re-exports (schemas as values, types separately) so the
// root barrel can compose domain + http + events without star-export collisions.
export { userSchema } from './user.js';
export type { User } from './user.js';

export { speakerRoleSchema, sessionStatusSchema, conversationSessionSchema } from './session.js';
export type { SpeakerRole, SessionStatus, ConversationSession } from './session.js';

export {
  languageCodeSchema,
  translationDirectionSchema,
  transcriptSegmentSchema,
  voiceGenderSchema,
  DEFAULT_VOICE_GENDER,
} from './transcript.js';
export type {
  LanguageCode,
  TranslationDirection,
  TranscriptSegment,
  VoiceGender,
} from './transcript.js';

export { translateModeSchema, DEFAULT_TRANSLATE_MODE } from './translate-mode.js';
export type { TranslateMode } from './translate-mode.js';
