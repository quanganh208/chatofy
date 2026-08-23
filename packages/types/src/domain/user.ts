// User domain types — schema-first (zod is the source of truth, types inferred).
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  // OUTPUT contract stays permissive: this schema is also the client safeParse
  // boundary, so tightening to z.email() would reject legacy/seed emails on a 200.
  // Email-format validation belongs on INPUT request schemas (see http/auth.ts).
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;
