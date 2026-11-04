// Two Chromium peers in one meeting through the real web UI, with `getStats()`
// logged from each. This is the media half of the ruler; `replay-meeting.mts`
// measures translation, which never touches the SFU.
//
//   node benchmarks/conference/media-call.mjs --base-url <site> \
//     --account-file "$A" --account-file "$B" --seconds 180 [--force-relay] --run-tag <tag>
//
// An account file is mode 600 and holds `{ "email": …, "password": … }`. The
// peers sign in through the form, because a bearer token cannot open the page.
// Each account keeps one browser context for the whole run: replaying a session
// in another context trips refresh-token reuse detection.
//
// The microphones are Chromium's fake beeps, so the meeting's translation has no
// speech to spend calls on. `--force-relay` sets `iceTransportPolicy: 'relay'`,
// which is how the TURN path gets exercised from a network that does not need it.
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '..', '..', 'apps', 'extension', 'package.json'))(
  'playwright',
);

const SAMPLE_EVERY_MS = 5_000;

function parseArgs(argv) {
  const args = { accounts: [], seconds: 60, forceRelay: false, baseUrl: '', runTag: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--base-url') args.baseUrl = argv[++i];
    else if (flag === '--account-file') args.accounts.push(argv[++i]);
    else if (flag === '--seconds') args.seconds = Number(argv[++i]);
    else if (flag === '--force-relay') args.forceRelay = true;
    else if (flag === '--run-tag') args.runTag = argv[++i];
    else throw new Error(`unknown flag ${flag}`);
  }
  if (args.accounts.length !== 2) throw new Error('--account-file is required twice');
  if (!args.baseUrl || !args.runTag) throw new Error('--base-url and --run-tag are required');
  return args;
}

function readAccount(path) {
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error(`${path} is readable by others; chmod 600 it`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Keeps every peer connection reachable, and forces relay when asked. */
const initScript = (forceRelay) => `
  const Native = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (config) {
    const pc = new Native({ ...(config ?? {}), ...(${forceRelay} ? { iceTransportPolicy: 'relay' } : {}) });
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Native.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Native);
`;

/** One sample per peer connection, read in the page. */
async function sample(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue;
      const stats = await pc.getStats();
      const byId = new Map([...stats.values()].map((report) => [report.id, report]));
      const row = {
        state: pc.connectionState,
        rttMs: null,
        localCandidate: null,
        remoteCandidate: null,
        inbound: [],
        outbound: [],
      };
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined)
            row.rttMs = report.currentRoundTripTime * 1000;
          row.localCandidate = byId.get(report.localCandidateId)?.candidateType ?? null;
          row.remoteCandidate = byId.get(report.remoteCandidateId)?.candidateType ?? null;
        } else if (report.type === 'inbound-rtp') {
          row.inbound.push({
            kind: report.kind,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            jitter: report.jitter,
            framesDecoded: report.framesDecoded,
            framesDropped: report.framesDropped,
            framesPerSecond: report.framesPerSecond,
            concealedSamples: report.concealedSamples,
            totalSamplesReceived: report.totalSamplesReceived,
          });
        } else if (report.type === 'outbound-rtp') {
          row.outbound.push({
            kind: report.kind,
            packetsSent: report.packetsSent,
            qualityLimitationReason: report.qualityLimitationReason,
          });
        }
      }
      out.push(row);
    }
    return out;
  });
}

async function signIn(page, baseUrl, account) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function joinCall(page) {
  await page.getByRole('button', { name: /join now|tham gia ngay/i }).click({ timeout: 30_000 });
  await page.waitForFunction(
    () => window.__pcs.some((pc) => pc.connectionState === 'connected'),
    undefined,
    {
      timeout: 45_000,
    },
  );
}

/** Totals over a run's last sample: counters are cumulative. */
function summarize(samples) {
  const last = samples.at(-1) ?? [];
  const inbound = last.flatMap((connection) => connection.inbound);
  const received = inbound.reduce((sum, stream) => sum + (stream.packetsReceived ?? 0), 0);
  const lost = inbound.reduce((sum, stream) => sum + Math.max(0, stream.packetsLost ?? 0), 0);
  const video = inbound.filter((stream) => stream.kind === 'video');
  const decoded = video.reduce((sum, stream) => sum + (stream.framesDecoded ?? 0), 0);
  const dropped = video.reduce((sum, stream) => sum + (stream.framesDropped ?? 0), 0);
  const rtts = samples
    .flat()
    .map((connection) => connection.rttMs)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  return {
    packetLossPercent: received + lost === 0 ? null : (100 * lost) / (received + lost),
    frameDropPercent: decoded + dropped === 0 ? null : (100 * dropped) / (decoded + dropped),
    framesDecoded: decoded,
    rttP50Ms: rtts.length ? rtts[Math.floor(rtts.length / 2)] : null,
    candidate: last.find((connection) => connection.localCandidate)?.localCandidate ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accounts = args.accounts.map(readAccount);
  const dir = join(HERE, 'results', args.runTag);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const pages = [];
    for (const account of accounts) {
      const context = await browser.newContext({
        locale: 'en-US',
        permissions: ['camera', 'microphone'],
      });
      await context.addInitScript(initScript(args.forceRelay));
      const page = await context.newPage();
      await signIn(page, args.baseUrl, account);
      pages.push(page);
    }
    const [host, guest] = pages;
    await host.goto(`${args.baseUrl}/conference`, { waitUntil: 'networkidle' });
    await host.getByRole('button', { name: /new meeting/i }).click();
    await host.waitForURL(/\/conference\/[^/]+$/, { timeout: 30_000 });
    await joinCall(host);
    await guest.goto(host.url(), { waitUntil: 'networkidle' });
    await joinCall(guest);

    const samples = [[], []];
    const end = Date.now() + args.seconds * 1000;
    while (Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_EVERY_MS));
      for (const [index, page] of pages.entries()) {
        const row = await sample(page);
        samples[index].push(row);
        appendFileSync(
          join(dir, 'media.jsonl'),
          `${JSON.stringify({ peer: index, at: Date.now(), row })}\n`,
        );
      }
    }
    const summaries = samples.map(summarize);
    console.log(JSON.stringify(summaries));
    const connected = summaries.filter((summary) => summary.framesDecoded > 0).length;
    console.log(`connected=${connected} candidate=${summaries[0]?.candidate}`);
    // Ending the meeting is the owner's; leaving a room with nobody in it ends it too.
    await host
      .getByRole('button', { name: /leave/i })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  } finally {
    await browser.close();
  }
}

await main();
