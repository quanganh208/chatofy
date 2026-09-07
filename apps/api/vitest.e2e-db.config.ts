import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The e2e suites that need a real Postgres. Split from the plain e2e config so
 * the fast suites are not held behind a service container.
 *
 * `fileParallelism: false` replaces jest's `--runInBand`, and is required
 * rather than tidy: these suites share one database, so running two files at
 * once lets one suite's truncation delete rows another is mid-assertion on.
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
    root: './test',
    include: ['**/*.db-e2e-spec.ts'],
    setupFiles: ['./setup-env-db.ts'],
    fileParallelism: false,
  },
});
