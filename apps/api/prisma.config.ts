import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  migrations: {
    adapter: () =>
      new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  },
});
