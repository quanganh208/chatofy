import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the audio and transport layer.
 *
 * Node environment on purpose: every module under test is deliberately free of
 * DOM and Web Audio APIs so the turn-taking policy, resampling and framing can
 * be exercised without a browser. React components are not covered here.
 */
export default defineConfig({
  // Component specs are .tsx and the transformer has to be told so. Next sets
  // `jsx: "preserve"` in its tsconfig — correct for Next, which compiles JSX
  // itself — and the test transformer reads the same field and leaves JSX in the
  // output, where it fails to parse.
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // `.tsx` too: a component spec placed in a package whose glob stops at
    // `.ts` is collected by nothing and reports nothing.
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
