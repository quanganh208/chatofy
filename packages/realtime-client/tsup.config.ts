import { defineConfig } from 'tsup';

// Dual CJS+ESM, matching `@chatofy/types`: the Next app and the extension are
// both bundler/ESM consumers, but keeping the CJS half costs nothing and means a
// node script can `require` the resampler when analysing a recording.
//
// A `build` script has to exist even though every consumer is a bundler. Turbo's
// tasks all declare `dependsOn: ["^build"]`, and a workspace with no `build`
// script is simply skipped — an app importing it would then resolve the `exports`
// map at an empty `dist`. `packages/ui` is the precedent for that failure.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Non-composite tsconfig — tsconfig.json stays composite for consumers.
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
