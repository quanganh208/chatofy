import { defineConfig } from 'tsup';

// Built rather than consumed as TypeScript source, matching @chatofy/types.
// Three bundlers read this package — Next, Vite through WXT, and Metro — and a
// source-only `exports` entry made Vite's transform fail to resolve this
// package's tsconfig at all. Dual CJS+ESM for the same reason types is: Metro
// still prefers CommonJS in places, and shipping both costs one line.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Non-composite variant — tsconfig.json stays composite for project references.
  tsconfig: 'tsconfig.build.json',
  dts: true,
  // The wipe lives in the `build` script, ahead of both configs, not in either
  // of them. Two configs writing one `outDir` with `clean` on means whichever
  // runs second deletes the first's output — and `files: ["dist"]` makes that a
  // package that installs with a missing entry, on a clean checkout, which is
  // the one case the README records as having reached CI before.
  clean: false,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
