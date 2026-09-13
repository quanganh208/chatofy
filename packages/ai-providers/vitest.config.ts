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
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
