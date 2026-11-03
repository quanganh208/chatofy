import { resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

/**
 * Loads the repo-root .env, the one dev env file every app shares.
 *
 * Imported FIRST by next.config.ts: ES imports hoist, so anything that reads
 * process.env at import time (src/config/env.ts, the CSP) must come after it.
 *
 * Next has already loaded apps/web before this runs and caches the result, so
 * a plain call is a no-op; forceReload (the fourth argument) makes it read the
 * root instead. Variables set in the real environment still win, as they do for
 * Next's own loading. Never create an apps/web/.env* file: Next watches that
 * directory and reloading from it would drop every root key until a restart.
 */
loadEnvConfig(resolve(__dirname, '..', '..'), process.env.NODE_ENV !== 'production', console, true);
