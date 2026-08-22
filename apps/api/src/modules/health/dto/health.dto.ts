import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shape for GET /health.
 * Health is EXCLUDED from the response envelope (probe body-shape stability),
 * so this DTO documents the raw shape directly.
 */
const healthSchema = z.object({
  status: z.literal('ok'),
  time: z.string(),
});

export class HealthDto extends createZodDto(healthSchema) {}
