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
  // The language this account's MAIL is written in — not a display setting. Which
  // language the UI renders in lives in a cookie and needs no row; this exists
  // because mail is composed when no browser is present to ask.
  //
  // Permissive `string` here for the same reason `email` is: this schema is also the
  // client's safeParse boundary, so narrowing the OUTPUT to the two locales this
  // build knows would make a row written by a newer api fail to parse on an older
  // client. Validation of what may be WRITTEN lives on the request schema.
  locale: z.string(),
});
export type User = z.infer<typeof userSchema>;
