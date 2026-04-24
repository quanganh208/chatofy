// ESLint config for Next.js apps — extends base + next plugin
'use strict';

const base = require('./base.cjs');

/** @type {import('eslint').Linter.Config[]} */
const nextjs = [
  ...base,
  // eslint-config-next exposes a flat-compat array when required
  // Next.js 15+ ships its own flat config export
  ...(() => {
    try {
      // Next.js 15 flat config
      return require('eslint-config-next/flat');
    } catch {
      return [];
    }
  })(),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Next.js allows console in API routes; warn only in client components
      'no-console': 'warn',
    },
  },
];

module.exports = nextjs;
