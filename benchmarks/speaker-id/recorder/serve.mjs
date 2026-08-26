/**
 * Static server for the channel recorder.
 *
 * `getUserMedia` needs a secure context, and `localhost` qualifies — which is
 * the whole reason this exists rather than opening the file directly. A
 * `file://` page gets no microphone at all.
 *
 * `/worklets/` is mapped to the real worklet in `packages/realtime-client`
 * rather than to a copy. The point of this fixture is that its capture path is
 * production's; a copied worklet could drift from production's and nothing
 * would report it.
 *
 * Run:
 *     node benchmarks/speaker-id/recorder/serve.mjs
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const WORKLET_DIR = join(REPO_ROOT, 'packages/realtime-client/worklets');

/** Deterministic per-project port, per the repo's process-management rule. */
const PORT = Number(process.env.PORT ?? 4317);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Resolve a URL path inside one root, refusing anything that escapes it. */
function resolveWithin(root, urlPath) {
  const candidate = join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  return candidate.startsWith(root) ? candidate : null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const path = url.pathname === '/' ? '/index.html' : url.pathname;

  const file = path.startsWith('/worklets/')
    ? resolveWithin(WORKLET_DIR, path.slice('/worklets'.length))
    : resolveWithin(HERE, path);

  if (!file) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    response.writeHead(404).end(`not found: ${path}`);
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(PORT, () => {
  console.log(`recorder on http://localhost:${PORT}`);
  console.log(`worklet served from ${WORKLET_DIR}`);
  console.log('grant microphone access when prompted; two tracks are opened, which is expected');
});
