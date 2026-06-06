import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  displayName?: string;
}

/**
 * Service identity sourced from apps/api/package.json — the single source of
 * truth shared by the Swagger document and the `/` service descriptor.
 *
 * Path is resolved relative to this module so it works in both runtimes:
 *   dev  → src/common/app-info.ts  → ../../package.json (apps/api/package.json)
 *   prod → dist/common/app-info.js → ../../package.json (Docker copies
 *          package.json next to dist/, WORKDIR /app)
 *
 * `name` is the npm package id ("api") kept for pnpm/turbo filters; `displayName`
 * holds the human title ("Chatofy API") and is preferred for presentation.
 */
const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8'),
) as PackageManifest;

export const appInfo = {
  name: manifest.displayName ?? manifest.name,
  version: manifest.version,
  description: manifest.description ?? '',
} as const;
