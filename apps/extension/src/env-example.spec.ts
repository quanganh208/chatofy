import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_API_BASE_URL } from './settings';

/**
 * Holds `.env.example` and the one value it documents together.
 *
 * The template shows `# WXT_API_BASE_URL=http://localhost:3000` — a claim that
 * this is the fallback a build already applies. Nothing but this spec stops
 * that claim from going quietly out of date, which is the state the api
 * template was in when it drifted.
 *
 * Only one key exists here, and there is no schema: WXT exposes any `WXT_`
 * variable to the bundle as `import.meta.env`, so "what the app reads" is not
 * a list this file can enumerate. It checks the claim it can check.
 */
const template = readFileSync(resolve(__dirname, '..', '.env.example'), 'utf8');

describe('apps/extension/.env.example', () => {
  it('shows the fallback settings.ts actually applies', () => {
    expect(template).toContain(`# WXT_API_BASE_URL=${DEFAULT_API_BASE_URL}`);
  });

  it('ships the key switched off, so a copy cannot release a localhost build', () => {
    // `prezip` rejects an unset value AND a localhost one, so either form fails
    // closed. Commented is the one that keeps `.env` honest about what a
    // developer actually chose.
    expect(template).not.toMatch(/^WXT_API_BASE_URL=/m);
  });
});
