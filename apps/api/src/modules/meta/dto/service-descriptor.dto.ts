import { createZodDto } from 'nestjs-zod';
import { serviceDescriptorSchema } from '@chatofy/types';

/**
 * Response shape for GET / — a minimal, prod-safe service descriptor.
 *
 * Wraps the shared contract rather than redeclaring it, so a client parsing
 * `serviceDescriptorSchema` and this endpoint's Swagger schema cannot drift.
 */
export class ServiceDescriptorDto extends createZodDto(
  serviceDescriptorSchema,
) {}
