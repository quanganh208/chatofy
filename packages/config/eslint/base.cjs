// Base ESLint flat config — TypeScript + unused-imports
// Consumed by all apps and packages as the foundation preset.
'use strict';

/** @type {import('eslint').Linter.Config[]} */
const base = [
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      'unused-imports': require('eslint-plugin-unused-imports'),
    },
    rules: {
      // TypeScript essentials
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Unused imports / vars
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // General
      'no-console': 'warn',
    },
  },
];

module.exports = base;
