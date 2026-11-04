/**
 * Environment for the database-backed suite.
 *
 * Unlike the fast suites, this one talks to a real Postgres, so DATABASE_URL is
 * NOT defaulted — a silent fallback to a URL nothing is listening on turns a
 * missing service container into an obscure connection error several seconds
 * into the run. It fails here instead, saying what is missing.
 *
 * The hint uses host port 5434 on purpose: the production compose stack binds
 * its Postgres to 127.0.0.1:5433 (docs/deployment-guide.md), so a test database
 * on 5433 either fails to start or, worse, points the suite at production data.
 * Redis is listed because the app needs it at boot; without it requests answer
 * 500 and the failures look like a regression rather than a missing service.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'The database-backed e2e suite needs DATABASE_URL pointing at a real Postgres.\n' +
      '  docker run --rm -d -p 5434:5432 -e POSTGRES_USER=chatofy \\\n' +
      '    -e POSTGRES_PASSWORD=chatofy -e POSTGRES_DB=chatofy postgres:16-alpine\n' +
      '  docker run --rm -d -p 127.0.0.1:6379:6379 redis:8-alpine\n' +
      '  DATABASE_URL=postgresql://chatofy:chatofy@localhost:5434/chatofy pnpm --filter api test:e2e:db\n' +
      'Never use 5433 here: that is the production Postgres on the deploy host.',
  );
}

// Only the signing secret is defaulted: it is not a service, and any stable
// value long enough for the schema does.
process.env.AUTH_JWT_SECRET ??= 'db-e2e-secret-not-for-any-real-deployment';

// Google's own verification is stubbed in the suite, but the route refuses
// before it calls out when no client id is configured — so the linking policy
// is only reachable with this set. What it contains does not matter here; that
// the id is passed through as the audience is covered in the verifier's spec.
process.env.AUTH_GOOGLE_ID ??= 'db-e2e-google-client-id';

// Meetings always load, and the SFU client refuses to construct without both.
process.env.CLOUDFLARE_REALTIME_APP_ID ??= 'test-realtime-app-id';
process.env.CLOUDFLARE_REALTIME_APP_SECRET ??= 'test-realtime-app-secret';
