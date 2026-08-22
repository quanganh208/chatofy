import { createZodDto } from 'nestjs-zod';
import {
  authSessionSchema,
  googleLoginRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  userSchema,
} from '@chatofy/types';

/**
 * Every auth DTO in one file, matching translate/dto/translate.dto.ts. These are
 * one-line wrappers over shared schemas; a file each would be four imports to
 * find one contract.
 */

/** POST /auth/register body (validated by the global ZodValidationPipe). */
export class RegisterRequestDto extends createZodDto(registerRequestSchema) {}

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
