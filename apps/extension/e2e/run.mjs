import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * A one-second sine tone as a WAV, for Chrome's fake capture device to play.
 *
 * Written rather than committed because it is three lines of arithmetic, and
 * because the alternative — the fake device's own default — turned out to be
 * silence, which is indistinguishable from the failure this harness exists to
 * catch.
 */
function toneWav(path) {
  const rate = 48000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0x3000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

/** Open the microphone and report how loud what comes back is. */
const MEASURE_RMS = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  let peak = 0;
  // Sampled repeatedly: one read can land between cycles of a tone.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((r) => setTimeout(r, 100));
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    peak = Math.max(peak, Math.sqrt(sum / buffer.length));
  }
  stream.getTracks().forEach((t) => t.stop());
  await context.close();
  return peak;
};

/**
 * The checks that need a real browser, run in one.
 *
 * The unit tests under `src/` prove sequencing, lifetimes and teardown against
 * fakes. They cannot answer whether Chrome grants a microphone to an extension
 * document, whether overriding `readyState` on a real `MediaStreamTrack` works
 * the way it does on an object literal, whether a composed track carries any
 * samples, or whether the meeting page can read the handshake meant for the
 * patch. Those are questions about Chrome, and only Chrome answers them.
 *
 * What is still NOT covered here, and why:
 *   - Meet, Zoom and Facebook's own clients. This serves its own page at their
 *     URLs so the match patterns fire; it is not their code, so "does the call
 *     still work" remains a hand check.
 *   - Whether any of it sounds right. Ducking, clicks, intelligibility.
 *   - Load. Two directions against one CPU is a measurement, not an assertion.
 */

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../.output/chrome-mv3');

/** A page that stands in for a meeting, with a spy on the page's own world. */
const MEETING_URL = 'https://meet.google.com/abc-defg-hij';
const MEETING_HTML = `<!doctype html>
<html>
  <head>
    <script>
      // Registered as early as a page script can be: the first thing in <head>.
      // If the handshake between the extension's two content scripts is visible
      // from here, then it is visible to any script the meeting site loads, and
      // to anything injected into it.
      window.__seen = [];
      window.addEventListener('message', (event) => {
        window.__seen.push({
          type: typeof event.data === 'object' && event.data ? event.data.type : String(event.data),
          ports: event.ports.length,
        });
      });
    </script>
  </head>
  <body>meeting stand-in</body>
</html>`;

const results = [];
let failures = 0;

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function report(name, detail) {
  results.push({ name, passed: null, detail });
  console.log(`INFO  ${name} — ${detail}`);
}

const userDataDir = mkdtempSync(resolve(tmpdir(), 'chatofy-e2e-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    // A fake microphone that emits a tone, and an auto-accepted prompt.
    //
    // The prompt flag has a cost worth stating: it makes this harness unable to
    // answer whether `audioCapture` grants the microphone on its own. Headless
    // Chromium denies `getUserMedia` to everything without it — a web page and
    // an extension page alike — so removing it does not isolate the extension's
    // permission, it just denies both. That question stays a hand check; see the
    // note printed at the end of this run.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    // The fake device's own default is silence, which is exactly what a broken
    // patch produces. Feeding it a tone is what makes the difference visible.
    `--use-file-for-fake-audio-capture=${toneWav(resolve(mkdtempSync(resolve(tmpdir(), 'chatofy-tone-')), 'tone.wav'))}`,
    // Lets an AudioContext start without a user gesture, so "the context would
    // not start" failures here are real ones rather than an artefact of
    // automation.
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  // ---------------------------------------------------------------- loading
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  check('extension loads and its service worker starts', Boolean(extensionId), extensionId);
  check(
    'manifest carries the permissions the feature needs',
    ['audioCapture', 'scripting', 'tabCapture', 'offscreen'].every((p) =>
      manifest.permissions.includes(p),
    ),
    manifest.permissions.join(', '),
  );
  check(
    'neither outbound script ships in the manifest',
    manifest.content_scripts.length === 1 &&
      manifest.content_scripts[0].js[0].endsWith('content.js'),
    manifest.content_scripts.flatMap((s) => s.js).join(', '),
  );

  // -------------------------------------- the microphone reaches the graph
  // Not the permission question — see the launch flags. What this does prove is
  // that an extension document can open the device and get audio out of it,
  // which is the half that lives in our code rather than Chrome's policy.
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extensionId}/popup.html`);
  const micProbe = await probe.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label ?? '';
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true, label };
    } catch (err) {
      return { ok: false, label: String(err) };
    }
  });
  check('an extension document can open the microphone', micProbe.ok, micProbe.label);

  // -------------------------------------------- dynamic registration on/off
  const registered = async () =>
    worker.evaluate(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      return scripts.map((s) => s.id);
    });

  check('nothing is registered while outbound is off', (await registered()).length === 0);

  await worker.evaluate(async () => {
    const KEY = 'chatofy.settings';
    const stored = await chrome.storage.local.get(KEY);
    await chrome.storage.local.set({
      [KEY]: { ...(stored[KEY] ?? {}), outbound: true, apiBaseUrl: 'http://localhost:3000' },
    });
  });
  await new Promise((r) => setTimeout(r, 1000));
  const onIds = await registered();
  check(
    'turning outbound on registers the patch',
    onIds.includes('chatofy-microphone-patch'),
    onIds.join(', ') || 'none',
  );

  // ------------------------------------------------------- the meeting page
  const page = await context.newPage();
  await page.route('https://meet.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: MEETING_HTML }),
  );
  await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const patched = await page.evaluate(() =>
    Object.prototype.hasOwnProperty.call(navigator.mediaDevices, 'getUserMedia'),
  );
  check('the page world carries the patch when outbound is on', patched);

  // This is the check that killed the original handshake. An earlier design
  // transferred a `MessagePort` to the page world at `document_start`, on the
  // reasoning that no page script had run yet; this harness showed the page's
  // own `<head>` script receiving both the message and the port. Nothing is sent
  // to the page world now, so nothing is there to take.
  const seen = await page.evaluate(() => window.__seen ?? []);
  const fromUs = seen.filter((m) => String(m.type).startsWith('chatofy'));
  check(
    'the extension sends the page world nothing it could intercept',
    fromUs.length === 0,
    fromUs.length
      ? `page received ${fromUs.length} message(s) from us, ports: ${fromUs
          .map((m) => m.ports)
          .join('/')}`
      : `page saw ${seen.length} unrelated message(s)`,
  );

  // And the answer the overlay depends on comes back through Chrome rather than
  // from the page, so it cannot be forged by a script on the page.
  const workerAnswer = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (!tab?.id) return null;
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => Object.prototype.hasOwnProperty.call(navigator.mediaDevices, 'getUserMedia'),
    });
    return probe?.result ?? null;
  });
  check(
    'the worker can ask Chrome whether a tab is patched',
    workerAnswer === true,
    `${workerAnswer}`,
  );

  // ------------------------------- the composed track, against real Web APIs
  const track = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [t] = stream.getAudioTracks();
    const clone = t.clone();
    const before = { readyState: t.readyState, muted: t.muted, label: t.label, id: t.id };
    const settings = t.getSettings();
    t.stop();
    const afterStop = t.readyState;
    return { before, settings, afterStop, cloneLabel: clone.label, cloneId: clone.id };
  });

  check(
    'the composed track reports the real device metadata',
    track.before.label.length > 0 && track.before.id.length > 0,
    `label="${track.before.label}" id="${track.before.id}"`,
  );
  check(
    'overriding readyState works on a real MediaStreamTrack',
    track.before.readyState === 'live' && track.afterStop === 'ended',
    `before=${track.before.readyState} after stop=${track.afterStop}`,
  );
  check(
    'clone() keeps the proxied metadata',
    // The id is deliberately NOT compared: a clone gets its own id per spec, and
    // the proxy delegates to the cloned device, so a matching id would mean the
    // clone was lying about being a different track.
    track.cloneLabel === track.before.label && track.cloneId.length > 0,
    `clone label="${track.cloneLabel}"`,
  );
  report('channel count the client sees', JSON.stringify(track.settings.channelCount ?? 'unset'));

  const patchedRms = await page.evaluate(MEASURE_RMS);

  // ------------------------------------------------------- turning it off
  await worker.evaluate(async () => {
    const KEY = 'chatofy.settings';
    const stored = await chrome.storage.local.get(KEY);
    await chrome.storage.local.set({ [KEY]: { ...(stored[KEY] ?? {}), outbound: false } });
  });
  await new Promise((r) => setTimeout(r, 1000));
  check('turning outbound off unregisters the patch', (await registered()).length === 0);

  const fresh = await context.newPage();
  await fresh.route('https://meet.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: MEETING_HTML }),
  );
  await fresh.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });
  await fresh.waitForTimeout(400);
  const stillPatched = await fresh.evaluate(() =>
    Object.prototype.hasOwnProperty.call(navigator.mediaDevices, 'getUserMedia'),
  );
  check(
    'a user who never enables this is not detectable as a Chatofy user',
    stillPatched === false,
  );

  // The control. Without it, "the patched track is silent" and "this harness
  // cannot hear anything" are the same reading.
  const unpatchedRms = await fresh.evaluate(MEASURE_RMS);
  check(
    'the harness can hear the fake microphone at all',
    unpatchedRms > 0.001,
    `unpatched rms=${unpatchedRms.toFixed(5)}`,
  );
  check(
    'the composed track carries audio, not silence',
    patchedRms > 0.001,
    `patched rms=${patchedRms.toFixed(5)} against unpatched ${unpatchedRms.toFixed(5)}`,
  );
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n${results.filter((r) => r.passed === true).length} passed, ${failures} failed`);
console.log(
  '\nStill a hand check, and why:\n' +
    '  - whether `audioCapture` alone grants the microphone: headless denies it to\n' +
    '    every origin, so removing the auto-accept flag proves nothing\n' +
    "  - whether Meet, Zoom and Facebook's own clients keep working: this serves\n" +
    '    its own page at their URLs, not their code\n' +
    '  - whether any of it sounds right, and what two directions cost one CPU',
);
process.exit(failures > 0 ? 1 : 0);
