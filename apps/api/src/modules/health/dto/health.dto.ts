import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shape for GET /health and /health/ready.
 * Health is EXCLUDED from the response envelope (probe body-shape stability),
 * so this DTO documents the raw shape directly.
 */
const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  time: z.string(),
  db: z.enum(['ok', 'error']).optional(),
});

export class HealthDto extends createZodDto(healthSchema) {}
