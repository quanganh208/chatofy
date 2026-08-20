import { defineConfig } from 'vitest/config';

/**
 * Tests for the token module and, once they land, the React components behind
 * `@chatofy/ui/react`.
 *
 * This package had no test runner at all until now, which was not a gap anyone
 * noticed — it held only data. It became a real one the moment components moved
 * here: a spec file placed in a package that defines no `test` script is skipped
 * by `turbo run test` and reports nothing, forever. The guards that keep
 * generated shadcn components on this project's tokens live here, so the runner
 * has to exist before the first one is written.
 *
 * Node by default, because most of what is asserted here is strings and numbers.
 * A component spec that needs a document opts in per file with
 * `// @vitest-environment happy-dom` on its first line, rather than the whole
 * package paying for a DOM it mostly does not use.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
