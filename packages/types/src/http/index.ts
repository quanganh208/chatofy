// HTTP contract barrel — named re-exports (NOT `export *`) so the root barrel
// can compose domain + http + events without star-export name collisions.

// Response envelope: schemas (runtime values) + inferred types.
export {
  errorCodeSchema,
  paginationSchema,
  apiMetaSchema,
  apiErrorSchema,
  apiErrorResponseSchema,
  apiSuccessSchema,
  apiResponseSchema,
} from './response.js';
export type {
  ErrorCode,
  Pagination,
  ApiMeta,
  ApiError,
  ApiErrorResponse,
  ApiSuccess,
  ApiResponse,
} from './response.js';

// Auth contracts.
export {
  loginRequestSchema,
  registerRequestSchema,
  passwordSchema,
  emailSchema,
  linkTokenSchema,
  AUTH_LIMITS,
  verifyEmailRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  requestLocaleSchema,
  updateMeRequestSchema,
  uploadAvatarRequestSchema,
  authMessageSchema,
  authMessageCodeSchema,
  VERIFY_EMAIL_MESSAGES,
  googleLoginRequestSchema,
  authTokenSchema,
  authSessionSchema,
} from './auth.js';
export type {
  AuthMessageCode,
  UpdateMeRequest,
  UploadAvatarRequest,
  LoginRequest,
  RegisterRequest,
  VerifyEmailRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  AuthMessage,
  GoogleLoginRequest,
  AuthToken,
  AuthSession,
} from './auth.js';

// Meta contracts — the root service descriptor at GET /.
export { serviceDescriptorSchema } from './meta.js';
export type { ServiceDescriptor } from './meta.js';

// Session contracts.
export { createSessionRequestSchema, sessionResponseSchema } from './sessions.js';
export type { CreateSessionRequest, SessionResponse } from './sessions.js';

// Translate contracts. (translationDirectionSchema/TranslationDirection are owned
// by the domain barrel — not re-exported here to avoid a duplicate-name conflict.)
export {
  translateRequestSchema,
  translateResponseSchema,
  directionLanguages,
} from './translate.js';
export type { TranslateRequest, TranslateResponse } from './translate.js';

// Meeting-minutes contracts. (meetingMinutesSchema/MeetingMinutes and the
// action-item + status schemas are owned by the domain barrel — not re-exported
// here, to avoid a duplicate-name conflict.)
export {
  MINUTES_LIMITS,
  minutesSourceTurnSchema,
  generateMinutesRequestSchema,
  minutesResponseSchema,
} from './minutes.js';
export type { MinutesSourceTurn, GenerateMinutesRequest, MinutesResponse } from './minutes.js';

// Glossary management contracts. (GLOSSARY_LIMITS, glossaryTermSchema, and
// glossaryTermRecordSchema are owned by the domain barrel — not re-exported here,
// to avoid a duplicate-name conflict.)
export {
  createGlossaryTermRequestSchema,
  updateGlossaryTermRequestSchema,
  glossaryListResponseSchema,
  importGlossaryRequestSchema,
} from './glossary.js';
export type {
  CreateGlossaryTermRequest,
  UpdateGlossaryTermRequest,
  GlossaryListResponse,
  ImportGlossaryRequest,
} from './glossary.js';
