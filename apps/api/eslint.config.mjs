import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** @type {import('eslint').Linter.Config[]} */
const nestjsConfig = require('@chatofy/config/eslint/nestjs');

export default nestjsConfig;
