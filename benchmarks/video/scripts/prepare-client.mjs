/**
 * prepare-client.mjs
 * Bundles mediasoup-client into a browser IIFE so bench-client.html can use
 * window.mediasoupClient without hitting unpkg.com.
 */
import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dest = resolve(root, 'client', 'mediasoup-client.min.js');

await build({
  entryPoints: ['mediasoup-client'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'mediasoupClient',
  outfile: dest,
  minify: false,
  absWorkingDir: root,
});

console.log(`✓ Bundled mediasoup-client → client/mediasoup-client.min.js`);
