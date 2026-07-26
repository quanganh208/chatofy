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
    },
  },
);
