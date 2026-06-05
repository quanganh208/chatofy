import { createZodDto } from 'nestjs-zod';
// Shared contract from the root barrel (api moduleResolution:"node" ignores subpaths).
import { authProvidersResponseSchema } from '@chatofy/types';

/** Response shape for GET /auth/providers (which auth provider is active). */
export class AuthProvidersDto extends createZodDto(
  authProvidersResponseSchema,
) {}
