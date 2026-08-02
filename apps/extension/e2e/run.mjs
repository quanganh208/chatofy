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
    // The prompt flag stands in for the user clicking Allow on the grant page. It
    // is also why this harness cannot show that the grant is REQUIRED — with every
    // origin auto-accepted, a build that had forgotten the grant page entirely
    // would still pass the probes below. What it does cover is that the manifest
    // no longer claims a permission Chrome refuses, and that the page which asks
    // is in the build.
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
    ['scripting', 'tabCapture', 'offscreen'].every((p) => manifest.permissions.includes(p)),
    manifest.permissions.join(', '),
  );
  // `audioCapture` is a Chrome App permission. Declaring it in an extension is
  // rejected at load with "only allowed for packaged apps" and grants nothing — it
  // sat in this manifest for a while looking like the microphone was handled.
  check(
    'no app-only permission is declared',
    !['audioCapture', 'videoCapture'].some((p) => manifest.permissions.includes(p)),
    manifest.permissions.join(', '),
  );
  check(
    'neither outbound script ships in the manifest',
    manifest.content_scripts.length === 1 &&
      manifest.content_scripts[0].js[0].endsWith('content.js'),
    manifest.content_scripts.flatMap((s) => s.js).join(', '),
  );

  // -------------------------------------- the microphone reaches the graph
  // The page that asks for the grant, driven the way a user reaches it: opened,
  // and left to ask on its own. It is the only surface that can raise Chrome's
  // prompt, so a build where it is missing or throws has no microphone at all.
  const grant = await context.newPage();
  await grant.goto(`chrome-extension://${extensionId}/microphone.html`);
  await grant.waitForSelector('#outcome:not([hidden])', { timeout: 5000 });
  const outcome = await grant.evaluate(() => ({
    ok: document.getElementById('outcome')?.className === 'ok',
    text: document.getElementById('outcome')?.textContent ?? '',
  }));
  check('the grant page asks for the microphone and reports the answer', outcome.ok, outcome.text);

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
  // Whatever the worker receives from the page, recorded here so the relay below
  // can be checked. Installed before the page loads, because the page world
  // starts reporting within 250ms of `document_start`.
  await worker.evaluate(() => {
    self.__seen = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      self.__seen.push({ type: message?.type, from: sender?.tab?.id ?? null });
    });
  });

  const page = await context.newPage();
  await page.route('https://meet.google.com/**', (route) =>
    route.fulfill({
      status: 200,
      // Served the way the real sites serve themselves. Meet sends this, and the
      // MAIN-world script runs under the PAGE's policy rather than the
      // extension's — so without it every check below runs under a permission
      // model no user is ever on. It also keeps an honest record of what the
      // policy does and does not break: it blocks `Function('')`, which is why a
      // `TrustedScript` violation appears in the console from a dependency's eval
      // feature-detect, and it does not stop any of this from working.
      headers: {
        'content-type': 'text/html',
        'content-security-policy': "require-trusted-types-for 'script'",
      },
      body: MEETING_HTML,
    }),
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
    'no channel is ever handed to the page world',
    fromUs.every((m) => m.ports === 0),
    `page saw ${fromUs.length} message(s) from us, ports: ${
      fromUs.map((m) => m.ports).join('/') || 'none'
    }`,
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

  // ------------------------------- audio actually reaching the outgoing track
  // The whole point of the feature: a translated sentence handed to the page has
  // to come out of the track the meeting client is transmitting. Measured on the
  // composed track while a burst of tone is injected the way a turn would be.
  const injected = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);

    // Measured by FREQUENCY rather than by level, because the device's own tone
    // is still playing underneath: the microphone cannot be muted to isolate the
    // injection, since `enabled = false` silences the whole composed track
    // including what is injected into it. So the injected tone is a different
    // pitch, and what is looked for is energy appearing at that pitch.
    const INJECTED_HZ = 1200;
    const bin = Math.round(INJECTED_HZ / (context.sampleRate / analyser.fftSize));
    const energy = () => {
      analyser.getByteFrequencyData(spectrum);
      return Math.max(spectrum[bin - 1] ?? 0, spectrum[bin] ?? 0, spectrum[bin + 1] ?? 0);
    };

    await new Promise((r) => setTimeout(r, 300));
    const before = energy();

    // A quarter second of tone as PCM16 at 24kHz — the shape a real turn arrives
    // in, posted the way the extension's relay posts it.
    const rate = 24000;
    const samples = new Int16Array(rate / 4);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * INJECTED_HZ * i) / rate) * 0x5000);
    }
    let binary = '';
    for (const byte of new Uint8Array(samples.buffer)) binary += String.fromCharCode(byte);
    window.postMessage(
      { type: 'chatofy:audio', turnKey: 'turn-1', payload: btoa(binary), sampleRate: rate },
      window.origin,
    );

    let during = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((r) => setTimeout(r, 40));
      during = Math.max(during, energy());
    }

    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    return { before, during };
  });

  check(
    'a translated sentence comes out of the track the meeting transmits',
    injected.during > injected.before + 40,
    `energy at the injected pitch: ${injected.before} before, ${injected.during} during`,
  );

  // ------------------------- the track the client kept, not the one asked last
  // Meeting clients call `getUserMedia` more than once: a device preview, the
  // call, a settings panel, every device change. The patch composes a graph per
  // call and injects into the LAST one, on the assumption that the client
  // transmits the newest track. Nothing enforces that. A client that keeps
  // transmitting an earlier track gets a graph nothing is ever put into — while
  // `transmitting` reads true off the newest one, so the extension reports
  // "your speech is being translated into the meeting" and the meeting is silent.
  const olderTrack = await page.evaluate(async () => {
    // The one the client keeps and transmits.
    const kept = await navigator.mediaDevices.getUserMedia({ audio: true });
    // A later call the client makes for something else entirely.
    const later = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(kept).connect(analyser);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const INJECTED_HZ = 1200;
    const bin = Math.round(INJECTED_HZ / (context.sampleRate / analyser.fftSize));
    const energy = () => {
      analyser.getByteFrequencyData(spectrum);
      return Math.max(spectrum[bin - 1] ?? 0, spectrum[bin] ?? 0, spectrum[bin + 1] ?? 0);
    };

    await new Promise((r) => setTimeout(r, 300));
    const before = energy();

    const rate = 24000;
    const samples = new Int16Array(rate / 4);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * INJECTED_HZ * i) / rate) * 0x5000);
    }
    let binary = '';
    for (const byte of new Uint8Array(samples.buffer)) binary += String.fromCharCode(byte);
    window.postMessage(
      { type: 'chatofy:audio', turnKey: 'kept-turn', payload: btoa(binary), sampleRate: rate },
      window.origin,
    );

    let during = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((r) => setTimeout(r, 40));
      during = Math.max(during, energy());
    }

    [kept, later].forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await context.close();
    return { before, during };
  });

  check(
    'a translated sentence reaches the track the client kept, not only the newest',
    olderTrack.during > olderTrack.before + 40,
    `energy on the kept track: ${olderTrack.before} before, ${olderTrack.during} during`,
  );

  // -------------------------------------------------------- the mute promise
  // The one privacy rule: while the meeting client has muted the track it was
  // handed, the extension must stop capturing the user's microphone entirely.
  // Reported by the page world, which is the only side that can see it.
  const muteReport = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [track] = stream.getAudioTracks();
    const seen = [];
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data?.type === 'chatofy:transmitting') {
        seen.push(event.data.transmitting);
      }
    });
    await new Promise((r) => setTimeout(r, 400));
    track.enabled = false;
    await new Promise((r) => setTimeout(r, 600));
    const afterMute = seen.at(-1);
    track.enabled = true;
    await new Promise((r) => setTimeout(r, 600));
    stream.getTracks().forEach((t) => t.stop());
    return { afterMute, afterUnmute: seen.at(-1), seen };
  });

  check(
    'muting in the meeting client is reported to the extension',
    muteReport.afterMute === false && muteReport.afterUnmute === true,
    `reports: ${JSON.stringify(muteReport.seen)}`,
  );

  // The check above proves the page world POSTS. It says nothing about the hops
  // after it, and those decide whether anything is ever sent: the offscreen
  // document opens assuming the client is muted, and only this relay raises it. A
  // report that stopped at the isolated content script would leave the user
  // talking, the transcript filling, and the meeting silent — with the overlay
  // blaming a mute the user never set.
  const relayed = await worker.evaluate(() =>
    (self.__seen ?? []).filter((m) => m.type === 'outbound.transmitting'),
  );
  check(
    'the page report reaches the service worker, not just the page',
    relayed.length > 0 && relayed.every((m) => typeof m.from === 'number'),
    `${relayed.length} report(s), tab ids: ${[...new Set(relayed.map((m) => m.from))].join(',') || 'none'}`,
  );

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
    '  - whether the grant given on the grant page is the one the OFFSCREEN document\n' +
    '    then uses: `--use-fake-ui-for-media-stream` accepts for every origin, so it\n' +
    '    cannot tell an inherited grant from an auto-accepted second prompt\n' +
    "  - whether Meet, Zoom and Facebook's own clients keep working: this serves\n" +
    '    its own page at their URLs, not their code\n' +
    '  - whether any of it sounds right, and what two directions cost one CPU',
);
process.exit(failures > 0 ? 1 : 0);
