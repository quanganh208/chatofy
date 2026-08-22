import { defineConfig } from 'tsup';

/**
 * The React entry, built separately from the tokens.
 *
 * Two configs rather than two entries in one, because the two halves need
 * opposite things. The tokens entry must stay importable by Metro and carry no
 * directive; this one is all-client and carries one on every chunk. A single
 * config cannot express both, and the tokens output must not change at all —
 * `apps/mobile` reads it.
 *
 * `clean` is off here and in the sibling config; the wipe happens once in the
 * `build` script ahead of both. With it on in either, the second run deletes the
 * first's output and the package installs with a missing entry.
 */
export default defineConfig({
  entry: { react: 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: false,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
  /**
   * Every chunk is a client module.
   *
   * esbuild hoists a `"use client"` out of the source and drops it, so the
   * directive has to be reapplied at the top of the output. The usual plugin for
   * this (`esbuild-plugin-preserve-directives`) is v0.0.11, last touched in
   * September 2024, single maintainer — not something to put under a build.
   *
   * The banner is blanket, which is only safe while this entry exports nothing a
   * server component may import. A variants object or a `cn` used for SSR class
   * computation would be marked a client reference and Next would refuse it. The
   * rule that keeps this true: anything server-safe gets its own entry, without
   * the banner. `directive.spec.ts` asserts the output actually carries it.
   */
  banner: { js: '"use client";' },
  /**
   * No code splitting, so no chunk can be emitted that the banner above did not
   * reach. Splitting would produce shared chunks written without it, imported by
   * banner-carrying ones, and Next would see a server module in the middle of a
   * client graph.
   */
  splitting: false,
  /**
   * Provided by the consumer, never bundled. Bundling React here would put a
   * second copy in every app that already has one, which is the hook crash
   * `scripts/check-single-react.mjs` exists to catch.
   */
  external: ['react', 'react-dom'],
});
