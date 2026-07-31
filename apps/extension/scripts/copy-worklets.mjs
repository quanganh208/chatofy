/**
 * Copy the capture worklet out of `@chatofy/realtime-client` into `public/`.
 *
 * WXT copies `public/` into the built extension verbatim, which is what this file
 * needs: an AudioWorklet module is fetched by URL from the audio thread, so it has to
 * remain a standalone file. A bundler that inlined it into a chunk would leave
 * `addModule` with nothing to load.
 *
 * Copied rather than kept here, so the extension and the web app cannot drift apart
 * on a block size the resampler assumes. `apps/web/scripts/copy-worklets.mjs` does
 * the same for the same reason.
 *
 * The destination is gitignored, so a checkout that skips this step fails loudly at
 * `addModule` rather than serving a stale copy nobody remembers editing.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKLET = 'mic-capture-processor.js';

const require = createRequire(import.meta.url);
const source = require.resolve(`@chatofy/realtime-client/worklets/${WORKLET}`);
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'worklets');

mkdirSync(target, { recursive: true });
copyFileSync(source, join(target, WORKLET));

console.log(`worklets: ${WORKLET} -> public/worklets/`);
