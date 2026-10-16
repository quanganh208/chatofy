const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');

// Load DATABASE_URL from apps/api/.env, resolved relative to this script so the
// script works from any working directory (not just apps/api).
const envPath = path.join(__dirname, '..', '.env');
const envLine = fs
  .readFileSync(envPath, 'utf8')
  .split('\n')
  .find((l) => l.startsWith('DATABASE_URL='));
const dbUrl = envLine
  ? envLine.split('=').slice(1).join('=').trim()
  : process.env.DATABASE_URL;

async function main() {
  const adapter = new PrismaPg({ connectionString: dbUrl });
  const db = new PrismaClient({ adapter });
  try {
    const hash = await argon2.hash('Benchmark123!');
    const user = await db.user.create({
      data: {
        email: 'bench@dev.local',
        name: 'Bench',
        passwordHash: hash,
        locale: 'en',
      },
    });
    console.log('Created user id=' + user.id);
  } catch (e) {
    console.error('Failed:', e.message);
  } finally {
    await db.$disconnect();
  }
}

main();
