import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the parts of the extension that are not the browser.
 *
 * Node environment, like the other packages here. Nothing under `src/` that is
 * tested touches a Chrome API or a Web Audio global directly — the sequencing
 * lives in `meeting-capture.ts` behind injected dependencies, and the
 * entrypoints under `entrypoints/` are the thin layer that supplies the real
 * ones. That split is what makes "the meeting must be audible before anything
 * waits on a human" a thing a test can assert rather than a comment.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
