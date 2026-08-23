// Meta HTTP contracts — the root service descriptor served at GET /.
import { z } from 'zod';

/**
 * Response shape for GET / — a minimal, prod-safe service descriptor.
 *
 * Shared rather than api-local because it is the contract a client parses. The
 * api's ServiceDescriptorDto wraps this schema, the same way every other DTO
 * wraps its shared counterpart, so the two can never drift.
 *
 * `docs` is optional: the Swagger UI is only mounted in non-production, so the
 * link is omitted there rather than advertising a path that 404s.
 * Intentionally exposes no secrets, env, or internal topology.
 */
export const serviceDescriptorSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  status: z.literal('ok'),
  docs: z.string().optional(),
});
export type ServiceDescriptor = z.infer<typeof serviceDescriptorSchema>;
