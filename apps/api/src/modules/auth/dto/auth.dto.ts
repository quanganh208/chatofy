import { createZodDto } from 'nestjs-zod';
import {
  authMessageSchema,
  authSessionSchema,
  authTokenSchema,
  refreshRequestSchema,
  revokeRequestSchema,
  forgotPasswordRequestSchema,
  googleLoginRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  userSchema,
  updateMeRequestSchema,
  uploadAvatarRequestSchema,
  verifyEmailRequestSchema,
} from '@chatofy/types';

/**
 * Every auth DTO in one file, matching translate/dto/translate.dto.ts. These are
 * one-line wrappers over shared schemas; a file each would be four imports to
 * find one contract.
 */

/** POST /auth/register body (validated by the global ZodValidationPipe). */
export class RegisterRequestDto extends createZodDto(registerRequestSchema) {}

/** POST /auth/verify-email body — the token from the mailed link. */
export class VerifyEmailRequestDto extends createZodDto(
  verifyEmailRequestSchema,
) {}

/** POST /auth/forgot-password body. */
export class ForgotPasswordRequestDto extends createZodDto(
  forgotPasswordRequestSchema,
) {}

/** POST /auth/reset-password body — the token plus the new password. */
export class ResetPasswordRequestDto extends createZodDto(
  resetPasswordRequestSchema,
) {}

/**
 * What register, verify, forgot and reset all answer with.
 *
 * One DTO for all four is the point, not a shortcut: register must answer a
 * fresh and a taken address identically, and a per-route response shape is how
 * that quietly stops being true.
 */
export class AuthMessageDto extends createZodDto(authMessageSchema) {}

/** POST /auth/login body. */
export class LoginRequestDto extends createZodDto(loginRequestSchema) {}

/** POST /auth/google body — the id_token Google issued to the client. */
export class GoogleLoginRequestDto extends createZodDto(
  googleLoginRequestSchema,
) {}

/** The payload register, login and Google login all return. */
export class AuthSessionDto extends createZodDto(authSessionSchema) {}

/**
 * POST /auth/refresh body.
 *
 * The token only. No user id and no email: the family record knows whose it is,
 * and a caller-supplied subject would be a claim the server has to ignore
 * anyway.
 */
export class RefreshRequestDto extends createZodDto(refreshRequestSchema) {}

/** POST /auth/revoke body — the family to end, named by one of its tokens. */
export class RevokeRequestDto extends createZodDto(revokeRequestSchema) {}

/**
 * What POST /auth/refresh answers with — the TOKEN half only.
 *
 * Deliberately not `AuthSessionDto`: a renewal that also re-sent the profile
 * would overwrite a client's freshly edited one on a schedule.
 */
export class AuthTokenDto extends createZodDto(authTokenSchema) {}

/** GET /auth/me payload. */
export class UserDto extends createZodDto(userSchema) {}

/** PATCH /auth/me body — the one field an account holder may change about their row. */
export class UpdateMeRequestDto extends createZodDto(updateMeRequestSchema) {}

/**
 * PUT /auth/me/avatar body — base64 image bytes.
 *
 * Carries no user id, exactly as `UpdateMeRequestDto` does not: the row is the
 * caller's own and comes from the verified token, so there is no field a caller
 * could point at somebody else's account.
 */
export class UploadAvatarRequestDto extends createZodDto(
  uploadAvatarRequestSchema,
) {}
