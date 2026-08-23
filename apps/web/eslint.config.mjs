// @ts-check
//
// Mirrors `apps/api/eslint.config.mjs` rather than pulling in a Next preset:
// the same rules, the same devDependencies already in the repo, and no new
// packages to resolve. What differs is the environment — this code runs in a
// browser, and its tests run under Vitest rather than Jest.
//
// This app went a long time without any linting at all, which is how roughly a
// thousand lines of the most defect-prone code in the project — audio capture,
// turn taking, socket handling — ended up as the only unlinted source here.
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      '.next/**',
      'next-env.d.ts',
      // Runs inside an AudioWorklet, which has neither DOM nor Node globals.
      'public/worklets/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // The one Next-preset rule worth the dependency. `exhaustive-deps` is what
  // catches a value read inside a `useCallback` but missing from its deps — the
  // shape of a real defect here: both translate hooks captured the access token
  // on their first render, when the session had not resolved, so every socket
  // dialled with an empty credential for a signed-in user. Nothing else in this
  // config can see that class of bug.
  reactHooks.configs.flat['recommended-latest'],
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Matches the api config: these fire on legitimate test doubles and on
      // JSON coming off a socket, where the shape is checked by a schema rather
      // than by the compiler.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      // A warning, not an error, and only this rule out of the react-hooks set.
      // It wants `useSyncExternalStore` wherever an effect seeds state from a
      // browser store, which is a correct long-term direction but flags the
      // pre-existing SSR-safe theme read — code this change has no business
      // rewriting. `exhaustive-deps` and `refs`, the two that catch the defect
      // class this plugin was added for, stay errors.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
);
