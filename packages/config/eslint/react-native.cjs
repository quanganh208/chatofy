// ESLint config for React Native / Expo apps — extends base + expo preset
'use strict';

const base = require('./base.cjs');

/** @type {import('eslint').Linter.Config[]} */
const reactNative = [
  ...base,
  ...(() => {
    try {
      // eslint-config-expo ships flat config in recent versions
      return require('eslint-config-expo/flat');
    } catch {
      try {
        return require('eslint-config-expo');
      } catch {
        return [];
      }
    }
  })(),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // RN debug output is common; keep as warn
      'no-console': 'warn',
    },
  },
];

module.exports = reactNative;
