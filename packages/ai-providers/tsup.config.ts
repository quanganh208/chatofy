import { defineConfig } from 'tsup';

// Dual CJS+ESM build so the CommonJS NestJS api (which can only `require`) and
// ESM bundler consumers can both import the concrete providers. Mirrors the
// @chatofy/types build. With "type": "module", tsup emits ESM as .js and CJS as
// .cjs, plus matching .d.ts / .d.cts declarations.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Non-composite tsconfig — tsconfig.json stays composite for project refs.
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
