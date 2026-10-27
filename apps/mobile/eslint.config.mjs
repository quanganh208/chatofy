// @ts-check
//
// Built from the same parts as `apps/web/eslint.config.mjs` rather than from
// `eslint-config-expo`. That preset bundles eslint-plugin-react and
// eslint-plugin-import, and neither has a release that runs on ESLint 10:
// eslint-plugin-react calls `context.getFilename`, which ESLint 10 removed, so
// every file failed to lint. What the preset added on top of this config is kept:
// Expo's own rules, the hooks rules, and React's component checks, which come
// from @eslint-react instead. Unresolved imports, the main job of
// eslint-plugin-import, are already a `tsc` error here.
import eslint from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import expo from 'eslint-plugin-expo';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['android/**', 'ios/**', 'dist/**', '.expo/**', 'expo-env.d.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintReact.configs['recommended-typescript'],
  reactHooks.configs.flat['recommended-latest'],
  {
    // Hooks rules come from the React team's plugin, as on web; @eslint-react's
    // copies of them would report every finding twice.
    rules: {
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
    },
  },
  {
    plugins: { expo },
    rules: {
      'expo/use-dom-exports': 'error',
      'expo/no-env-var-destructuring': 'error',
      'expo/no-dynamic-env-var': 'error',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        __DEV__: 'readonly',
        // Metro inlines `process.env.EXPO_PUBLIC_*` at bundle time.
        process: 'readonly',
      },
    },
  },
  {
    // Metro and Babel load these with Node's CommonJS loader.
    files: ['*.config.js', 'babel.config.js', 'metro.config.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // `node --test` runs the specs directly under Node.
    files: ['src/**/*.test.ts'],
    languageOptions: { globals: globals.node },
  },
);
