import { createZodDto } from 'nestjs-zod';
import { authProvidersResponseSchema } from '@chatofy/types';

/** Response shape for GET /auth/providers (which auth provider is active). */
export class AuthProvidersDto extends createZodDto(
  authProvidersResponseSchema,
) {}
