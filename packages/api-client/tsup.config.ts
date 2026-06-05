import { defineConfig } from 'tsup';

// Dual CJS+ESM so bundler consumers (web/mobile) and any CJS test runner can
// both import the client. tsconfig is non-composite, so no separate build config.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
