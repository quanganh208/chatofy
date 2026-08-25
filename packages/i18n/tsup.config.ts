import { defineConfig } from 'tsup';

/**
 * Dual CJS+ESM, matching `packages/types`.
 *
 * The ESM half is what web imports. The CJS half exists for the same reason it
 * does there: a CommonJS consumer can only `require`, and the NestJS api is the
 * likely second reader once the mail templates need these strings.
 *
 * **No `"use client"` banner**, unlike `packages/ui/tsup.react.config.ts`. That
 * banner marks every export a client reference, and a server component reading a
 * string would then be refused by Next. This package is plain data and plain
 * functions; the React provider that genuinely needs the directive lives in
 * `apps/web`, which is also its only consumer today.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Non-composite variant, for the reason `packages/types` records: tsup's
  // declaration build cannot run under composite/incremental project-reference
  // mode, while the main tsconfig must stay composite for consumers.
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
