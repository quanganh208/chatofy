/**
 * run-once.ts
 *
 * Launch N headless Chromium pages, join a shared mediasoup room, hold for
 * SAMPLE_WINDOW_MS, collect server + client metrics, write one run JSON to
 * results/, and exit.
 *
 * Usage:
 *   pnpm run-once --count 2 --res 360p30
 *   pnpm run-once --count 4 --res 720p30 --repeat 2
 *
 * Env:
 *   API_BASE_URL   HTTP base for the NestJS API (default: http://localhost:3000)
 *   API_WS_URL     WebSocket URL for /ws/conference  (default: ws://localhost:3000/ws/conference)
 *   BENCH_EMAIL / BENCH_PASSWORD
 *                  Bench accounts to sign in with. Peer i signs in as the i-th
 *                  account (bench@, bench+2@, …) because the gateway keeps one
 *                  socket per user in a room; create them with
 *                  `BENCH_USERS=<max peers> node apps/api/scripts/create-bench-user.cjs`.
 *   SAMPLE_WINDOW  Hold time in seconds (default: 30)
 *   API_PID        PID of the API process for OS metrics (optional)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectMetricsSamples, type AveragedMetrics } from './metrics.js';
import { getClientCpuMetrics, type ClientCpuMetrics } from './client-cpu.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', '..', 'results');

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const API_WS_URL = process.env['API_WS_URL'] ?? 'ws://localhost:3000/ws/conference';
const SAMPLE_WINDOW_MS = (parseInt(process.env['SAMPLE_WINDOW'] ?? '30', 10) || 30) * 1000;
const API_PID = process.env['API_PID'] ? parseInt(process.env['API_PID'], 10) : null;

const BENCH_EMAIL = process.env['BENCH_EMAIL'] ?? 'bench@dev.local';

/** bench@dev.local for peer 0, bench+N@dev.local for peer N-1 (matches create-bench-user.cjs). */
function benchEmailFor(peerIndex: number): string {
  if (peerIndex === 0) return BENCH_EMAIL;
  const at = BENCH_EMAIL.indexOf('@');
  return `${BENCH_EMAIL.slice(0, at)}+${peerIndex + 1}${BENCH_EMAIL.slice(at)}`;
}

async function login(email: string): Promise<string> {
  const password = process.env['BENCH_PASSWORD'];
  if (!password) throw new Error('BENCH_PASSWORD is not set');
  const resp = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) throw new Error(`Login as ${email} failed: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as { data?: { token?: { accessToken?: string } } };
  const token = body.data?.token?.accessToken;
  if (!token) throw new Error(`Login response for ${email} is missing the token`);
  return token;
}

/** One access token per peer, each for a different bench account. */
async function resolveAuthTokens(participantCount: number): Promise<string[]> {
  const tokens = await Promise.all(
    Array.from({ length: participantCount }, (_, i) => login(benchEmailFor(i))),
  );
  console.log(`  ✓ ${tokens.length} auth tokens obtained via login`);
  return tokens;
}

/** Rooms exist only once POST /conference created them; the gateway refuses any other id. */
async function createRoom(token: string): Promise<string> {
  const resp = await fetch(`${API_BASE_URL}/conference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'benchmark' }),
  });
  if (!resp.ok) throw new Error(`POST /conference failed: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as { data?: { id?: string } };
  const id = body.data?.id;
  if (!id) throw new Error('POST /conference response is missing the room id');
  return id;
}

const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  // Allow WebRTC to use loopback (127.0.0.1) ICE candidates.
  // Chromium drops loopback candidates by default per the WebRTC spec; this flag
  // is required for local SFU benchmarks where the announced IP is 127.0.0.1.
  '--allow-loopback-in-peer-connection',
];

export type Resolution = '360p30' | '720p30' | '720p60';

const RES_MAP: Record<Resolution, { width: number; height: number; fps: number }> = {
  '360p30': { width: 640, height: 360, fps: 30 },
  '720p30': { width: 1280, height: 720, fps: 30 },
  '720p60': { width: 1280, height: 720, fps: 60 },
};

export interface RunConfig {
  participantCount: number;
  resolution: Resolution;
  runIndex?: number;
}

export interface RunResult {
  runId: string;
  timestamp: string;
  config: RunConfig;
  durationMs: number;
  server: AveragedMetrics;
  clientCpu: (ClientCpuMetrics | null)[];
  peerStates: PeerRunState[];
  notes: string;
  topology: string;
}

interface PeerRunState {
  peerName: string;
  socketId: string | null;
  producerIds: string[];
  consumerIds: string[];
  negotiatedCodecs: Record<string, string>;
  actualVideoSettings: Record<string, unknown> | null;
  finalStatus: string;
  errors: string[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runOnce(config: RunConfig): Promise<RunResult> {
  const { participantCount, resolution, runIndex = 0 } = config;

  const authTokens = await resolveAuthTokens(participantCount);
  const roomId = await createRoom(authTokens[0]!);
  const resInfo = RES_MAP[resolution];
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${participantCount}p-${resolution}-r${runIndex}`;
  console.log(`\n▶  Starting run: ${runId}`);
  console.log(
    `   participants=${participantCount} resolution=${resolution} window=${SAMPLE_WINDOW_MS / 1000}s room=${roomId}`,
  );

  const clientPage = resolve(__dirname, '..', '..', 'client', 'bench-client.html');

  const browser = await chromium.launch({
    headless: true,
    args: [...FAKE_MEDIA_ARGS, '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const pages: import('playwright').Page[] = [];

  const startMs = Date.now();

  try {
    // ── Launch N pages ──────────────────────────────────────────────────────
    for (let i = 0; i < participantCount; i++) {
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      });
      const page = await ctx.newPage();

      const url = new URL(`file://${clientPage}`);
      url.searchParams.set('apiWs', API_WS_URL);
      url.searchParams.set('roomId', roomId);
      url.searchParams.set('peerName', `peer-${i}`);
      url.searchParams.set('token', authTokens[i]!);
      url.searchParams.set('res', resolution);

      await page.goto(url.toString());
      pages.push(page);
      console.log(`  ✓ Page ${i} navigated`);
    }

    // ── Wait for all peers to reach "running" state ─────────────────────────
    console.log(`  Waiting for all ${participantCount} peers to join and produce…`);
    await Promise.all(
      pages.map((page, i) =>
        page
          .waitForFunction(
            () => {
              const s = (window as unknown as { __benchState: { status: string } }).__benchState;
              return s && (s.status === 'running' || s.status === 'error');
            },
            undefined,
            { timeout: 60_000 },
          )
          .catch((err) => console.warn(`  ⚠ Page ${i} join timeout: ${err.message}`)),
      ),
    );
    console.log(`  All peers joined. Holding for ${SAMPLE_WINDOW_MS / 1000}s…`);

    // ── Collect server metrics during the hold ──────────────────────────────
    const { average: serverAvg } = await collectMetricsSamples(
      API_BASE_URL,
      API_PID,
      SAMPLE_WINDOW_MS,
      2000,
    );

    // ── Collect client CPU from each page ───────────────────────────────────
    const clientCpuResults = await Promise.all(pages.map((p) => getClientCpuMetrics(p)));

    const durationMs = Date.now() - startMs;

    // ── Read peer state from each page ──────────────────────────────────────
    const peerStates: PeerRunState[] = await Promise.all(
      pages.map(async (page, i) => {
        try {
          const state = await page.evaluate(() => {
            const s = (window as unknown as Record<string, unknown>).__benchState as Record<
              string,
              unknown
            >;
            return {
              socketId: s['socketId'] as string | null,
              producerIds: s['producerIds'] as string[],
              consumerIds: s['consumerIds'] as string[],
              negotiatedCodecs: s['negotiatedCodecs'] as Record<string, string>,
              actualVideoSettings: s['actualVideoSettings'] as Record<string, unknown> | null,
              finalStatus: s['status'] as string,
              errors: s['errors'] as string[],
            };
          });
          return { peerName: `peer-${i}`, ...state };
        } catch {
          return {
            peerName: `peer-${i}`,
            socketId: null,
            producerIds: [],
            consumerIds: [],
            negotiatedCodecs: {},
            actualVideoSettings: null,
            finalStatus: 'unknown',
            errors: ['failed to read state'],
          };
        }
      }),
    );

    const result: RunResult = {
      runId,
      timestamp: new Date().toISOString(),
      config,
      durationMs,
      server: serverAvg,
      clientCpu: clientCpuResults,
      peerStates,
      notes: 'loopback-1machine',
      topology: 'driver+api-same-host-loopback',
    };

    // ── Write result JSON ────────────────────────────────────────────────────
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = resolve(RESULTS_DIR, `${runId}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  ✓ Result written: ${outPath}`);

    return result;
  } finally {
    await browser.close();
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

function parseArgs(): RunConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : def;
  };

  const count = parseInt(get('--count', '2'), 10);
  const res = get('--res', '360p30') as Resolution;
  const runIdx = parseInt(get('--repeat', '0'), 10);

  if (!RES_MAP[res]) {
    console.error(`Unknown resolution "${res}". Valid: ${Object.keys(RES_MAP).join(', ')}`);
    process.exit(1);
  }
  if (isNaN(count) || count < 1) {
    console.error('--count must be a positive integer');
    process.exit(1);
  }

  return { participantCount: count, resolution: res, runIndex: runIdx };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)
) {
  runOnce(parseArgs())
    .then((r) => {
      console.log('\n✅ Run complete:', r.runId);
      console.log('   Worker CPU avg:', r.server.workerCpuPct, '%');
      console.log('   Worker RSS avg:', r.server.workerRssKB, 'KB');
      console.log('   Bytes sent:', r.server.bytesSentMB, 'MB');
    })
    .catch((err) => {
      console.error('Run failed:', err);
      process.exit(1);
    });
}
