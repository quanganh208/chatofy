/**
 * Environment for the database-backed suite.
 *
 * Unlike the fast suites, this one talks to a real Postgres, so DATABASE_URL is
 * NOT defaulted — a silent fallback to a URL nothing is listening on turns a
 * missing service container into an obscure connection error several seconds
 * into the run. It fails here instead, saying what is missing.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'The database-backed e2e suite needs DATABASE_URL pointing at a real Postgres.\n' +
      '  docker run --rm -d -p 5433:5432 -e POSTGRES_USER=chatofy \\\n' +
      '    -e POSTGRES_PASSWORD=chatofy -e POSTGRES_DB=chatofy postgres:16-alpine\n' +
      '  DATABASE_URL=postgresql://chatofy:chatofy@localhost:5433/chatofy pnpm --filter api test:e2e:db',
  );
}

// Only the signing secret is defaulted: it is not a service, and any stable
// value long enough for the schema does.
process.env.AUTH_JWT_SECRET ??= 'db-e2e-secret-not-for-any-real-deployment';

// Google's own verification is stubbed in the suite, but the route refuses
// before it calls out when no client id is allowlisted — so the linking policy
// is only reachable with this set. What it contains does not matter here; that
// the allowlist is passed through correctly is covered in the verifier's spec.
process.env.GOOGLE_CLIENT_IDS ??= 'db-e2e-google-client-id';
