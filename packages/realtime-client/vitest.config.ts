import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the audio and transport layer.
 *
 * Node environment on purpose: every module under test is deliberately free of
 * the DOM and Web Audio at runtime, so the turn-taking policy, resampling and
 * framing can be exercised without a browser. `ConversationSession` does touch
 * those APIs, and reaches them only through injected dependencies — the fakes in
 * `src/conversation/fake-audio-context.ts` are what let it run here too.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
