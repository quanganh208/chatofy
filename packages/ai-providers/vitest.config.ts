import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the provider layer.
 *
 * Node environment: the providers under test reach the network only through
 * `fetch`, which the specs stub — a deadline is proven against a fetch that
 * never answers, not against a real socket.
 */
export default defineConfig({
  test: {
    // This workspace's own module cache. The default sits at the monorepo root, shared
    // by every workspace, so the first parallel run after a lockfile change had them
    // all clearing the same directory at once and one failed with ENOTEMPTY.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
