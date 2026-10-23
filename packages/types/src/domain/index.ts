// Domain barrel — named re-exports (schemas as values, types separately) so the
// root barrel can compose domain + http + events without star-export collisions.
export { userSchema } from './user.js';
export type { User } from './user.js';

export { speakerRoleSchema } from './session.js';
export type { SpeakerRole } from './session.js';

export {
  LANGUAGES,
  LANGUAGE_CODES,
  languageCodeSchema,
  languagePairOf,
  allLanguagePairs,
  reversePair,
  samePair,
  languagePairSchema,
  DEFAULT_LANGUAGE_PAIR,
  pairLanguages,
  translationTargets,
  speakerRoleFor,
  toLanguageCode,
  conversationLanguagesSchema,
  sourceLanguagesSchema,
  translationMapSchema,
  AUTO_DETECT,
  sessionLanguagePairSchema,
  IDENTIFIABLE_LANGUAGES,
  turnCandidates,
  canIdentify,
  detectConversationLanguages,
  isAutoDetectConversation,
} from './languages.js';
export type {
  LanguageCode,
  LanguageTable,
  LanguagePair,
  SessionLanguagePair,
} from './languages.js';

export { languagePairFromStoredDirection } from './stored-language-pair.js';

export {
  HAN_CHARACTER,
  UNSPACED_SCRIPT,
  hasHan,
  unspacedWordCount,
  wordsOf,
} from './script-words.js';

export { transcriptSegmentSchema, voiceGenderSchema, DEFAULT_VOICE_GENDER } from './transcript.js';
export type { TranscriptSegment, VoiceGender } from './transcript.js';

export { translateModeSchema, DEFAULT_TRANSLATE_MODE, LIVE_LANGUAGES } from './translate-mode.js';
export type { TranslateMode } from './translate-mode.js';

export { minutesStatusSchema, actionItemSchema, meetingMinutesSchema } from './minutes.js';
export type { MinutesStatus, ActionItem, MeetingMinutes } from './minutes.js';

export {
  conversationTurnSchema,
  conversationSummarySchema,
  conversationSchema,
  primaryTranslation,
} from './conversation.js';
export type { ConversationTurn, ConversationSummary, Conversation } from './conversation.js';
