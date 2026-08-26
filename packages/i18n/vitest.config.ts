import { defineConfig } from 'vitest/config';

/**
 * Node, with no plugins. This package is strings and two functions — nothing here
 * touches a document, and the parity that matters between locales is enforced by
 * `tsc` rather than by a spec.
 *
 * The runner exists because a spec file in a package with no `test` script is
 * skipped by `turbo run test` and reports nothing, forever — the trap
 * `packages/ui`'s own config records.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
