// Shared Prettier configuration for all workspaces.
// Keep in sync with root .prettierrc.cjs.
'use strict';

/** @type {import('prettier').Config} */
const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
};

module.exports = config;
