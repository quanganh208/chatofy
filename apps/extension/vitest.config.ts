import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the parts of the extension that are not the browser.
 *
 * Node environment by default, like the other packages here. Nothing under `src/`
 * that is tested touches a Chrome API or a Web Audio global directly — the
 * sequencing lives in `meeting-capture.ts` behind injected dependencies, and the
 * entrypoints under `entrypoints/` are the thin layer that supplies the real
 * ones. That split is what makes "the meeting must be audible before anything
 * waits on a human" a thing a test can assert rather than a comment.
 *
 * The popup is the exception and opts into a DOM per file with a
 * `// @vitest-environment happy-dom` line, rather than the whole package paying
 * for one it mostly does not use.
 *
 * No JSX plugin, unlike `packages/ui` and `apps/web`. Those two need one because
 * the tsconfig the transformer reads sets `jsx: "preserve"` — correct for Next,
 * which compiles JSX itself — and the JSX survives into the output unparsed. This
 * package's tsconfig sets `react-jsx`, so the default transform already handles
 * it. Verified by removing the plugin and watching the popup spec stay green.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` too: a component spec placed in a package whose glob stops at
    // `.ts` is collected by nothing and reports nothing.
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
