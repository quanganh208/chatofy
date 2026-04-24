// ESLint config for NestJS apps — extends base, relaxes console, allows decorators
'use strict';

const base = require('./base.cjs');

/** @type {import('eslint').Linter.Config[]} */
const nestjs = [
  ...base,
  {
    files: ['**/*.{ts,mts}'],
    rules: {
      // Server-side logging is intentional
      'no-console': 'off',

      // NestJS decorator patterns use parameter properties
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

module.exports = nestjs;
