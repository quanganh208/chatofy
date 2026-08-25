import { createZodDto } from 'nestjs-zod';
import {
  authMessageSchema,
  authSessionSchema,
  forgotPasswordRequestSchema,
  googleLoginRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  userSchema,
  updateMeRequestSchema,
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

/** GET /auth/me payload. */
export class UserDto extends createZodDto(userSchema) {}

/** PATCH /auth/me body — the one field an account holder may change about their row. */
export class UpdateMeRequestDto extends createZodDto(updateMeRequestSchema) {}
