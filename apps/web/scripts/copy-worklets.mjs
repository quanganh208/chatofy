/**
 * Copy the capture worklet out of `@chatofy/realtime-client` into `public/`.
 *
 * `AudioWorklet.addModule` takes a URL, and Next serves static files only from
 * `public/` — so the file has to physically sit there. It is not kept there as
 * its source of truth: the extension loads the same worklet through
 * `chrome.runtime.getURL`, and two hand-maintained copies of the block size would
 * drift out of step with the resampler that assumes it.
 *
 * Runs from `predev` and `prebuild`. The destination is gitignored, so a checkout
 * that skips this step fails loudly at `addModule` rather than serving a stale
 * copy nobody remembers editing.
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
