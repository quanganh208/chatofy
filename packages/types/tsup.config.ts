import { defineConfig } from 'tsup';

// Dual CJS+ESM build so both bundler consumers (web/mobile, ESM) and the
// CommonJS NestJS api (which can only `require`) can import schema VALUES.
// With "type": "module", tsup emits ESM as .js and CJS as .cjs, plus
// matching .d.ts / .d.cts declarations.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'domain/index': 'src/domain/index.ts',
    'http/index': 'src/http/index.ts',
    'events/index': 'src/events/index.ts',
  },
  format: ['esm', 'cjs'],
  // Non-composite tsconfig — tsconfig.json stays composite for project-reference consumers.
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'es2022',
});
