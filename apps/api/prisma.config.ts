import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Spread rather than defaulted to '': Prisma rejects an EMPTY
    // shadowDatabaseUrl outright (P1013), which would break every other command
    // — including the `migrate deploy` a deployment runs — for the sake of one
    // that only CI and a developer use. Absent is a valid state; empty is not.
    //
    // What it is for: `prisma migrate diff --from-migrations`, the check that
    // proves the migration chain and `schema.prisma` still agree. Prisma replays
    // the whole chain into this database to compare it, so it must be a
    // SEPARATE, disposable one — the diff drops and recreates its contents.
    // There is no `--shadow-database-url` CLI flag on Prisma 7; it is this
    // config field or nothing.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
  migrations: {
    adapter: () =>
      new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  },
});
