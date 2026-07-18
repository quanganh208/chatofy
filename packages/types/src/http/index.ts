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
  authTokenSchema,
  authSessionSchema,
  authProviderSchema,
  authProvidersResponseSchema,
} from './auth.js';
export type {
  LoginRequest,
  RegisterRequest,
  AuthToken,
  AuthSession,
  AuthProvider,
  AuthProvidersResponse,
} from './auth.js';

// Session contracts.
export { createSessionRequestSchema, sessionResponseSchema } from './sessions.js';
export type { CreateSessionRequest, SessionResponse } from './sessions.js';

// Translate contracts. (translationDirectionSchema/TranslationDirection are owned
// by the domain barrel — not re-exported here to avoid a duplicate-name conflict.)
export {
  translateRequestSchema,
  translateResponseSchema,
  directionLanguages,
  VIENEU_VOICES,
} from './translate.js';
export type { TranslateRequest, TranslateResponse } from './translate.js';
