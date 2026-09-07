import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the api. Node environment, specs beside the code they cover.
 *
 * SWC rather than vitest's default esbuild, and that is not a preference: Nest
 * resolves a constructor's dependencies from the `design:paramtypes` metadata
 * that `emitDecoratorMetadata` writes, and esbuild does not implement that
 * option at all. Under esbuild every `@Injectable()` class still compiles, and
 * then fails at wiring time with an undefined parameter type — so the loss
 * shows up as a DI error far from its cause. `unplugin-swc` reads the same
 * tsconfig the build does, which keeps the decorator semantics identical
 * between `nest build` and the runner.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reportsDirectory: './coverage',
    },
  },
});
