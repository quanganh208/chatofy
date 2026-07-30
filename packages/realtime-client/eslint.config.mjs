// @ts-check
//
// Mirrors `apps/web/eslint.config.mjs`, which is where this code was linted
// before it moved here. Carrying the config across with the files is the point:
// this is the most defect-prone source in the project — audio capture, turn
// taking, socket handling — and it spent a long time as the only unlinted code
// in the repo. A package with no `lint` script would put it straight back there,
// silently, because `turbo run lint` skips a workspace that has none.
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      // Runs inside an AudioWorklet, which has neither DOM nor Node globals.
      'worklets/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        // Browser for the audio graph and the socket; node for the two specs
        // that read WAV fixtures off disk.
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Matches the api and web configs: these fire on legitimate test doubles
      // and on JSON coming off a socket, where the shape is checked by a schema
      // rather than by the compiler.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
    },
  },
);
