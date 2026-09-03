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
    // `worklets/` too: the reframing in `rnnoise-frame-buffer.js` is pure and
    // served as-is (a worklet cannot import the bundled package), so its spec
    // lives beside it rather than under `src`, which `tsc` scopes to.
    include: ['src/**/*.spec.ts', 'worklets/**/*.spec.ts'],
  },
});
