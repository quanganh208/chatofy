import { createZodDto } from 'nestjs-zod';
import {
  authSessionSchema,
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

/** The payload both register and login return. */
export class AuthSessionDto extends createZodDto(authSessionSchema) {}

/** GET /auth/me payload. */
export class UserDto extends createZodDto(userSchema) {}
