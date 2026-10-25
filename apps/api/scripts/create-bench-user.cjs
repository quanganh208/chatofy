// Creates the dev-only bench accounts the conference benchmark and the mobile
// dev build sign in with.
//
//   BENCH_PASSWORD=... [BENCH_USERS=6] node apps/api/scripts/create-bench-user.cjs
//
// BENCH_EMAIL defaults to bench@dev.local. BENCH_USERS (default 1) creates that
// many accounts — bench@, bench+2@, bench+3@ … — because the conference
// gateway keeps one socket per user in a room, so every benchmark peer needs
// its own account. Existing accounts are left as they are. DATABASE_URL comes from the
// environment, or else from apps/api/.env (resolved relative to this script so
// it works from any working directory). Never point this at production.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');

function databaseUrlFromDotenv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  return line ? line.split('=').slice(1).join('=').trim() : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || databaseUrlFromDotenv();
const email = process.env.BENCH_EMAIL || 'bench@dev.local';
const password = process.env.BENCH_PASSWORD;
const userCount = Number.parseInt(process.env.BENCH_USERS || '1', 10);

/** bench@dev.local for the first account, bench+N@dev.local for the N-th. */
function benchEmail(index) {
  if (index === 1) return email;
  const at = email.indexOf('@');
  return `${email.slice(0, at)}+${index}${email.slice(at)}`;
}

if (!dbUrl) {
  fail('DATABASE_URL is not set and apps/api/.env has no DATABASE_URL line.');
}
if (!Number.isInteger(userCount) || userCount < 1) {
  fail('BENCH_USERS must be a positive integer.');
}
if (!password) {
  fail(
    'BENCH_PASSWORD is not set. Run: BENCH_PASSWORD=<password> node apps/api/scripts/create-bench-user.cjs',
  );
}

async function main() {
  const adapter = new PrismaPg({ connectionString: dbUrl });
  const db = new PrismaClient({ adapter });
  try {
    const hash = await argon2.hash(password);
    for (let i = 1; i <= userCount; i++) {
      const address = benchEmail(i);
      const existing = await db.user.findUnique({ where: { email: address } });
      if (existing) {
        console.log(`Exists  ${address} id=${existing.id}`);
        continue;
      }
      const user = await db.user.create({
        data: {
          email: address,
          name: `Bench ${i}`,
          passwordHash: hash,
          locale: 'en',
        },
      });
      console.log(`Created ${address} id=${user.id}`);
    }
  } catch (e) {
    process.exitCode = 1;
    console.error('Failed:', e instanceof Error ? e.message : String(e));
  } finally {
    await db.$disconnect();
  }
}

main();
