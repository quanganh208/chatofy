import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the shared contracts.
 *
 * Node environment: everything here is zod schema parsing — no DOM, no network,
 * no timers. A schema either accepts a body or it does not.
 *
 * This package held no harness until conversation recording added `offsetMs` to
 * the stored-turn contract and a byte ceiling to `HISTORY_LIMITS`. Both are
 * bounds whose whole job is to refuse something, and a bound with no test is a
 * claim rather than a guarantee — the same reason `packages/ai-providers` grew
 * one when its first deadline shipped.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
