import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The e2e suites that need no database. They override USER_REPOSITORY with an
 * in-memory implementation, so the real controller, argon2 and JWT issuance all
 * run while only the storage layer is faked.
 *
 * `setupFiles` has to land before AppModule is constructed: AUTH_JWT_SECRET is
 * required at boot with no "auth off" fallback, so without it every suite that
 * instantiates AppModule throws during module resolution. See setup-env.ts.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // This workspace's own module cache. The default sits at the monorepo root, shared
    // by every workspace, so the first parallel run after a lockfile change had them
    // all clearing the same directory at once and one failed with ENOTEMPTY.
    fsModuleCachePath: 'node_modules/.vitest-cache-e2e',
    environment: 'node',
    root: './test',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./setup-env.ts'],
  },
});
