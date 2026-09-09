/**
 * Environment every e2e suite needs before AppModule is constructed.
 *
 * Runs via `setupFiles` — before the test framework and therefore before any
 * import of AppModule reaches `validateEnv`. AUTH_JWT_SECRET is required at
 * boot with no "auth off" fallback, so without this every suite that
 * instantiates AppModule would throw during module resolution.
 *
 * `??=` throughout: a real value in the ambient environment (a developer
 * pointing a suite at a live database, CI supplying its own secret) always
 * wins over these defaults.
 */

// Fixed, not random: an expired-token test signs with the app's own JwtService,
// so the value only has to be stable within a run and long enough to clear the
// schema's 32-character floor.
process.env.AUTH_JWT_SECRET ??= 'test-secret-not-for-any-real-deployment-01';

// Most suites mock PrismaService outright and never open a connection; the URL
// only has to parse as a URL so env validation passes.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
