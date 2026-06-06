import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shape for GET / — a minimal, prod-safe service descriptor.
 *
 * `docs` is optional: the Swagger UI is only mounted in non-production, so the
 * link is omitted in production rather than advertising a path that 404s.
 * Intentionally exposes no secrets, env, or internal topology.
 */
const serviceDescriptorSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  status: z.literal('ok'),
  docs: z.string().optional(),
});

export class ServiceDescriptorDto extends createZodDto(
  serviceDescriptorSchema,
) {}
