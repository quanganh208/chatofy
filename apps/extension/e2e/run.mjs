import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * Refuse to run against an output directory older than the source it came from.
 *
 * This file loads a compiled extension and never compiles one. So editing the
 * overlay and running this suite exercises the previous bundle, reports every
 * check green, and says nothing about the change — which is exactly the shape of
 * silent pass the specs beside it exist to close, sitting in the harness that is
 * supposed to catch them. It happened during the work that added this guard.
 */
function newestChange(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(path) : statSync(path).mtimeMs);
  }
  return newest;
}

{
  const root = resolve(here, '..');
  let compiled;
  try {
    compiled = statSync(resolve(extensionPath, 'manifest.json')).mtimeMs;
  } catch {
    console.error(
      '\nThere is no compiled extension at .output/chrome-mv3.\n\n' +
        'This suite loads one and does not produce it. Compile the extension first.\n',
    );
    process.exit(1);
  }
  // Everything that ends up inside the bundle, not only this package's own two
  // directories. The realtime client and the shared types are compiled in, and the
  // manifest is written from wxt.config.ts — editing any of them and running this
  // suite would otherwise exercise the previous bundle and report it green, which is
  // the entire failure this guard exists for.
  const sources = Math.max(
    ...[
      resolve(root, 'src'),
      resolve(root, 'entrypoints'),
      resolve(root, '../../packages/realtime-client/src'),
      resolve(root, '../../packages/types/src'),
    ].map(newestChange),
    ...[resolve(root, 'wxt.config.ts'), resolve(root, 'package.json')].map(
      (file) => statSync(file).mtimeMs,
    ),
  );
  if (sources > compiled) {
    console.error(
      '\nThe compiled extension is older than its source.\n\n' +
        'This suite loads .output/chrome-mv3 and does not produce it, so it would be\n' +
        'testing the previous bundle and reporting it as green. Recompile first.\n',
    );
    process.exit(1);
  }
}

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

  // The popup assembles itself and its element lookup throws on a missing id. So
  // an id dropped from the markup while a lookup for it remains does not degrade
  // this page, it stops the script before its first line: no header, no settings,
  // no Start, and nothing on screen or in the console anyone would think to
  // report. Reaching the URL is not evidence it rendered — asking for the one
  // button it exists to offer is.
  //
  // Waited on rather than slept past. A fixed delay is a race that resolves
  // differently on a loaded CI runner than on a laptop, and the direction it
  // resolves badly is green: the page had not finished, the check measured
  // nothing, and nobody looks at a passing check. `catch` rather than `throw`
  // because a popup that never renders should fail THIS check by name, not abort
  // the suite twenty checks early.
  await probe
    .waitForFunction(() => document.getElementById('toggle')?.textContent?.trim(), null, {
      timeout: 5_000,
    })
    .catch(() => {});
  const rendered = await probe.evaluate(() => {
    const toggle = document.getElementById('toggle');
    return { ok: Boolean(toggle?.textContent?.trim()), text: toggle?.textContent ?? '' };
  });
  check('the popup renders its primary action', rendered.ok, rendered.text || 'blank');
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
      [KEY]: { ...(stored[KEY] ?? {}), outbound: true },
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

  // ------------------------------------------------- the overlay's isolation
  // The one thing the meeting must not be able to do: switch off the notice that
  // it is being recorded. Everyone in the call is being captured and only the
  // person running the extension knows, so an overlay a page can hide is worse
  // than no overlay at all.
  //
  // Measured through the HOST, because the root is closed and nothing inside it
  // can be selected from here — that is the whole point of it being closed. The
  // host is in the document tree, so its computed style is readable; and
  // `elementFromPoint` retargets to it, which is what proves the panel is really
  // painted rather than merely present.
  //
  // Finding the host without an id: a closed root is invisible from the page, so
  // the overlay is the only childless, empty top-level <div> on this stand-in.
  //
  // The filter is written out twice rather than shared through a helper: this page
  // is served under `require-trusted-types-for 'script'`, which blocks the
  // `new Function` a shared source string would need. Playwright's own evaluate
  // goes through CDP and is not subject to it.
  await page.waitForFunction(
    () =>
      [...document.body.children].filter(
        (el) => el.tagName === 'DIV' && el.childElementCount === 0 && !el.textContent,
      ).length === 1,
    null,
    { timeout: 5000 },
  );

  // Put the overlay into the state this section is actually about.
  //
  // Idle, it is a ~150px pill: small on purpose, suppressible on purpose, and not
  // the thing a meeting page must be unable to hide. What must survive is the
  // panel and the recording indicator inside it, which exist only while capture
  // runs — so the checks below would otherwise probe a point outside the pill and
  // report a hardening failure that is really a geometry mismatch.
  //
  // Pushed as a render rather than started for real. `tabCapture` needs an
  // invocation through Chrome's own UI that this harness cannot perform here, and
  // the isolation being tested is a property of the shadow tree and its
  // stylesheet — it does not depend on audio existing. The worker's own publisher
  // state is untouched, so the real capture later in this run overwrites this.
  const renderCapturing = (capturing) =>
    worker.evaluate(async (capturing) => {
      const [tab] = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      await chrome.tabs.sendMessage(tab.id, {
        to: 'content',
        type: 'render',
        state: { capturing, lines: [], outbound: 'off', errors: {} },
      });
    }, capturing);

  await renderCapturing(true);
  await page.waitForTimeout(100);
  //
  // Two attacks, run separately, because one masks the other. Once `display: none`
  // wins, the host has no layout box and Chromium resolves `transform` to `none`
  // whatever the page asked for — so a combined stylesheet would report a passing
  // transform for the wrong reason. The containing-block attack is also useless on
  // its own: `all: initial` leaves the host `display: inline`, and a transform on a
  // non-replaced inline box does nothing. It needs `display: block` alongside it,
  // which is exactly why the reset has to cover `all` rather than a property list.
  const ATTACKS = [
    {
      name: 'hide it',
      css: [
        'div[id] { display: none !important; }',
        '#chatofy-overlay-host { display: none !important; }',
        'body > div { display: none !important; visibility: hidden !important; opacity: 0 !important; }',
      ].join('\n'),
    },
    {
      name: 'move it off screen',
      // `display: block` makes the host a box; the transform then makes it a
      // containing block for the fixed panel inside it and drags the whole overlay
      // out of the viewport. Verified to work against an unhardened `:host`.
      css: 'body > div { display: block !important; transform: translateY(9999px) !important; }',
    },
  ];

  for (const attack of ATTACKS) {
    const isolation = await page.evaluate((css) => {
      const hosts = [...document.body.children].filter(
        (el) => el.tagName === 'DIV' && el.childElementCount === 0 && !el.textContent,
      );
      // Re-asserted here rather than trusting the wait above, so a harness page that
      // grows more markup reports a readable failure instead of throwing inside the
      // evaluate and taking the whole run down with it.
      if (hosts.length !== 1) return { hosts: hosts.length };
      const [host] = hosts;

      // Found by asking the page, before the attack is installed, rather than
      // computed from the panel's declared width and offsets.
      //
      // The shadow root is closed, so the panel's own box cannot be measured from
      // here — but the point where a hit test retargets to the host can be
      // discovered by looking. The previous constant was derived by hand from
      // right:16, bottom:16 and width:340, which meant rearranging the control row
      // could move the overlay out from under it and turn this check green by
      // missing rather than by surviving.
      //
      // This is stricter than the constant, not looser: finding no such point at
      // all fails, because an overlay that is nowhere is exactly what the attacks
      // below are trying to achieve. If one of them fails after a layout change, the
      // answer is not to widen the search.
      const hits = [];
      for (let dy = 4; dy < 460; dy += 8) {
        for (let dx = 4; dx < 400; dx += 8) {
          const x = window.innerWidth - dx;
          const y = window.innerHeight - dy;
          if (document.elementFromPoint(x, y) === host) hits.push({ x, y });
        }
      }
      if (!hits.length) return { hosts: 1, probe: null, hitCount: 0 };
      // The point nearest the middle of everything the overlay covers, rather than
      // the first one found. A corner hit is one rounding error away from being a
      // miss, and a probe that starts missing is a probe that stops testing.
      const cx = hits.reduce((a, h) => a + h.x, 0) / hits.length;
      const cy = hits.reduce((a, h) => a + h.y, 0) / hits.length;
      const dist = (h) => (h.x - cx) ** 2 + (h.y - cy) ** 2;
      const probe = hits.reduce((best, h) => (dist(h) < dist(best) ? h : best), hits[0]);

      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);

      const computed = getComputedStyle(host);
      const hit = document.elementFromPoint(probe.x, probe.y);
      const seen = {
        hosts: 1,
        probe,
        hitCount: hits.length,
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        transform: computed.transform,
        hitIsHost: hit === host,
      };
      // Removed before returning: it targets `body > div`, and leaving it installed
      // would quietly poison any DOM check added below this one.
      style.remove();
      return seen;
    }, attack.css);
    check(
      `the capture overlay survives a meeting page trying to ${attack.name}`,
      isolation.hosts === 1 &&
        isolation.probe != null &&
        isolation.display !== 'none' &&
        isolation.visibility === 'visible' &&
        isolation.opacity === '1' &&
        isolation.transform === 'none' &&
        isolation.hitIsHost,
      JSON.stringify(isolation),
    );
  }

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

  // ------------------------- the user's own voice on the track the client kept
  // The check above asks whether INJECTED audio reaches an older graph. This asks
  // the other half, and it is the half that was broken: whether the MICROPHONE
  // still does. `compose` used to cut the device out of the previous graph on
  // every new `getUserMedia`, so a settings panel or a device change left the
  // call transmitting a track carrying the translation and nothing else — the
  // user's real voice gone, with the track live, unmuted, and reporting a real
  // device the whole time. It needed no capture to be running: the tick alone
  // was enough, and only unticking it put the microphone back.
  const keptVoice = await page.evaluate(async () => {
    const rms = async (stream, ms = 700) => {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      let peak = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        await new Promise((r) => setTimeout(r, 50));
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      await context.close();
      return peak;
    };

    // The track the client joined with and goes on transmitting.
    const kept = await navigator.mediaDevices.getUserMedia({ audio: true });
    const before = await rms(kept);
    // What it asks for later, for a settings panel or a device change.
    const later = await navigator.mediaDevices.getUserMedia({ audio: true });
    const after = await rms(kept);

    [kept, later].forEach((s) => s.getTracks().forEach((t) => t.stop()));
    return { before, after };
  });

  check(
    "the user's own voice survives the client asking for a microphone again",
    keptVoice.before > 0.001 && keptVoice.after > 0.001,
    `rms on the kept track: ${keptVoice.before.toFixed(5)} before, ${keptVoice.after.toFixed(5)} after`,
  );

  // ------------------------------- and is replaced, not mixed, while sending
  // While a capture is sending, the meeting hears the translation INSTEAD of the
  // user, not on top of them: the two are the same person five seconds apart.
  // The gate is held by a lease the extension renews, and it has to reach the
  // track the client kept rather than only the newest one.
  const gating = await page.evaluate(async () => {
    const rms = async (stream, ms = 600) => {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      let peak = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        await new Promise((r) => setTimeout(r, 40));
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      await context.close();
      return peak;
    };
    const voice = (mine) => window.postMessage({ type: 'chatofy:voice', mine }, window.origin);

    const kept = await navigator.mediaDevices.getUserMedia({ audio: true });
    // The later call the client makes for something else, as above.
    const later = await navigator.mediaDevices.getUserMedia({ audio: true });
    const before = await rms(kept);

    // A capture starts sending.
    voice(false);
    await new Promise((r) => setTimeout(r, 300));
    const held = await rms(kept);

    // A translated sentence still has to come out of that same track.
    const rate = 24000;
    const samples = new Int16Array(rate);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * 1200 * i) / rate) * 0x5000);
    }
    let binary = '';
    for (const byte of new Uint8Array(samples.buffer)) binary += String.fromCharCode(byte);
    window.postMessage(
      { type: 'chatofy:audio', turnKey: 'gate-turn', payload: btoa(binary), sampleRate: rate },
      window.origin,
    );
    await new Promise((r) => setTimeout(r, 250));
    const translation = await rms(kept, 400);

    // The user presses Stop.
    voice(true);
    await new Promise((r) => setTimeout(r, 500));
    const released = await rms(kept);

    [kept, later].forEach((s) => s.getTracks().forEach((t) => t.stop()));
    return { before, held, translation, released };
  });

  check(
    'while sending, the meeting hears the translation instead of the user',
    gating.before > 0.001 && gating.held < 0.001 && gating.translation > 0.001,
    `rms: ${gating.before.toFixed(5)} idle, ${gating.held.toFixed(5)} held, ` +
      `${gating.translation.toFixed(5)} with a turn playing`,
  );
  check(
    'stopping the capture gives the user their own voice back',
    gating.released > 0.001,
    `rms after release: ${gating.released.toFixed(5)}`,
  );

  // ------------------------------------------ and the hold cannot outlive us
  // The gate is on a microphone in a page this extension does not control and
  // cannot be told about its own death. An offscreen document that crashes, is
  // killed by Chrome, or is thrown away by a developer reloading the extension
  // would otherwise leave the user talking into a meeting that cannot hear them,
  // with the track live, unmuted, and reporting a real device.
  const expiry = await page.evaluate(async () => {
    const rms = async (stream, ms = 500) => {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      let peak = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        await new Promise((r) => setTimeout(r, 40));
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      await context.close();
      return peak;
    };

    const kept = await navigator.mediaDevices.getUserMedia({ audio: true });
    window.postMessage({ type: 'chatofy:voice', mine: false }, window.origin);
    await new Promise((r) => setTimeout(r, 300));
    const held = await rms(kept);

    // Nothing renews it. Past the lease, the page decides on its own.
    await new Promise((r) => setTimeout(r, 3500));
    const afterExpiry = await rms(kept);

    kept.getTracks().forEach((t) => t.stop());
    return { held, afterExpiry };
  });

  check(
    'a hold that stops being renewed gives the microphone back on its own',
    expiry.held < 0.001 && expiry.afterExpiry > 0.001,
    `rms: ${expiry.held.toFixed(5)} held, ${expiry.afterExpiry.toFixed(5)} after the lease ran out`,
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

  // And the same promise where it was actually broken. `transmitting` read
  // `enabled` off the NEWEST composed graph, so a mute landing on the track the
  // client had joined with — while a settings panel or device change had since
  // composed another — reported "transmitting" for the rest of the call. The
  // meeting heard nothing, because the muted track carries nothing; the user was
  // recorded, transcribed and translated anyway, which is exactly the case this
  // direction promises cannot happen.
  const muteOnKept = await page.evaluate(async () => {
    const kept = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [keptTrack] = kept.getAudioTracks();
    const seen = [];
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data?.type === 'chatofy:transmitting') {
        seen.push(event.data.transmitting);
      }
    });
    await new Promise((r) => setTimeout(r, 400));
    // The later call, which the client is NOT transmitting.
    const later = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Long enough for the page world's 2s heartbeat, so "transmitting" is
    // observed rather than assumed. Without it the report stream can be empty
    // here — the state never changed — and a check reading only what arrives
    // after the mute would pass against a build that had never said yes at all.
    await new Promise((r) => setTimeout(r, 2300));
    const beforeMute = seen.at(-1);

    keptTrack.enabled = false;
    await new Promise((r) => setTimeout(r, 900));
    const afterMute = seen.at(-1);

    [kept, later].forEach((s) => s.getTracks().forEach((t) => t.stop()));
    return { beforeMute, afterMute, seen };
  });

  check(
    'a mute on the track the client kept is reported, not only on the newest',
    muteOnKept.beforeMute === true && muteOnKept.afterMute === false,
    `reports: ${JSON.stringify(muteOnKept.seen)}`,
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

  // ------------------------------------------- switching a platform off
  // Last, because it stops whatever is capturing and takes the overlay off the
  // page — there is nothing after this that would still work.
  //
  // Worth a check rather than trusting the unit tests: `runsOn` is pure and
  // covered, but WHERE the worker consults it is wiring, and the first version of
  // this gate sat in `toggleCaptureFor` — which the popup's Start message does not
  // go through. It reached `startCapture` directly and recorded on a platform the
  // user had switched off. The gate is at that choke point now; this is what says
  // so.
  const setSites = (disabledSites) =>
    worker.evaluate(
      (disabledSites) =>
        chrome.storage.local.set({ 'chatofy.sites': { enabled: true, disabledSites } }),
      disabledSites,
    );

  const overlayHosts = () =>
    page.evaluate(
      () =>
        [...document.body.children].filter(
          (el) => el.tagName === 'DIV' && el.childElementCount === 0 && !el.textContent,
        ).length,
    );

  // The content script still believes a capture is running — the isolation section
  // above pushed `capturing: true` and nothing retracted it. That makes this the
  // place to check the half of the rule that matters most: a preference cannot
  // take the recording indicator off a meeting that is still being recorded. In
  // the real flow the worker stops that capture first and the render saying so is
  // what releases the overlay; here the stale state stands in for the window
  // between those two steps.
  await setSites(['meet.google.com']);
  await page.waitForTimeout(600);
  check(
    'switching a platform off does NOT remove the overlay while capture is running',
    (await overlayHosts()) === 1,
    'hosts remaining: ' + (await overlayHosts()),
  );

  // And now the render that a real stop would have sent.
  await renderCapturing(false);
  await page.waitForTimeout(400);
  check(
    'the overlay leaves the page once the capture it was reporting has stopped',
    (await overlayHosts()) === 0,
    'hosts remaining: ' + (await overlayHosts()),
  );

  // Sent from an extension page: a service worker cannot message itself, and this
  // is the exact message the popup's Start button sends.
  const starter = await context.newPage();
  await starter.goto(`chrome-extension://${extensionId}/popup.html`);
  await starter.waitForTimeout(300);
  await starter.evaluate(
    (tabId) => chrome.runtime.sendMessage({ to: 'worker', type: 'start', tabId }),
    await worker.evaluate(
      async () => (await chrome.tabs.query({ url: 'https://meet.google.com/*' }))[0].id,
    ),
  );
  await starter.waitForTimeout(900);
  check(
    'the worker refuses to capture a platform that is switched off',
    (await worker.evaluate(() => chrome.offscreen.hasDocument())) === false,
  );
  await starter.close();

  await setSites([]);
  await page.waitForTimeout(600);
  check('switching it back on restores the overlay', (await overlayHosts()) === 1);

  // ------------------------------------------------------ the screenshot set
  /**
   * One still per state in the design guidelines' inventory, for a review pass a
   * person has to do by eye.
   *
   * Nothing here existed before: this file could drive the extension in detail and
   * could not photograph any of it. The states are reached by controlling what the
   * page is told rather than by waiting for the right moment to arrive — a set that
   * depends on timing is a set that quietly loses a state and still writes a folder
   * full of files.
   *
   * The popup is driven by replacing three answers it asks for before it renders:
   * which tab is in front of it, what the worker says the capture is doing, and
   * whether Chrome has given up the microphone. All three are questions with no
   * other deterministic answer inside a harness — the popup here is an ordinary
   * tab, so the tab it would be standing over is itself.
   */
  const shotsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'screenshots');
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  const shots = [];

  const save = async (node, target, name, options = {}) => {
    const index = shots.filter((s) => s.startsWith(target)).length + 1;
    const file = `${target}-${String(index).padStart(2, '0')}-${name}.png`;
    await node.screenshot({ path: resolve(shotsDir, file), ...options });
    shots.push(file);
    return file;
  };

  // ---- overlay, on the meeting page it actually lives on --------------------
  const renderOverlay = (state) =>
    worker.evaluate(async (state) => {
      const [tab] = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      await chrome.tabs.sendMessage(tab.id, { to: 'content', type: 'render', state });
    }, state);

  const idle = { capturing: false, lines: [], outbound: 'off', errors: {}, patched: true };
  const turns = [
    {
      sessionId: 's1',
      sourceText: 'So where did we land on the pricing question?',
      targetText: 'Vậy chúng ta đã chốt về câu hỏi giá chưa?',
      final: true,
      origin: 'them',
    },
    {
      sessionId: 's1',
      sourceText: 'Tôi nghĩ chúng ta nên giữ mức cũ thêm một quý nữa.',
      targetText: 'I think we should hold the current price for another quarter.',
      final: true,
      origin: 'me',
    },
    {
      sessionId: 's1',
      sourceText: 'That works for me, let us revisit in January',
      targetText: 'Được, tháng Một mình xem lại',
      final: false,
      origin: 'them',
    },
  ];

  const overlayStates = [
    ['pill-idle', idle],
    ['pill-recording', { ...idle, capturing: true }],
  ];
  const panelStates = [
    ['panel-idle-empty', idle],
    ['panel-recording-empty', { ...idle, capturing: true }],
    ['panel-with-turns', { ...idle, capturing: true, lines: turns }],
    ['error-capture', { ...idle, errors: { capture: 'This tab cannot be captured.' } }],
    [
      'error-both-directions',
      {
        ...idle,
        capturing: true,
        lines: turns.slice(0, 1),
        errors: { inbound: 'connection lost', outbound: 'connection lost' },
      },
    ],
    ['outbound-sending', { ...idle, capturing: true, lines: turns, outbound: 'sending' }],
    ['outbound-muted', { ...idle, capturing: true, lines: turns, outbound: 'muted' }],
    ['outbound-not-patched', { ...idle, capturing: true, outbound: 'monitor', patched: false }],
  ];

  /**
   * Which of the two surfaces is showing, measured rather than assumed.
   *
   * Expansion is internal state toggled by a click, and earlier sections of this
   * run leave it wherever they left it. Assuming collapsed produced two stills
   * labelled "pill" that were photographs of the panel — a set that is wrong is
   * worse than one that is missing, because it gets signed off.
   *
   * The shadow root is closed, so the answer comes from how tall the region that
   * retargets to the host is. The pill is one row; the panel is most of a corner.
   */
  // The shadow root is closed, so the pill cannot be selected — only found. The
  // same discovery the isolation probe uses: the point where a hit test retargets
  // to the host is the overlay, wherever it has moved to.
  const overlayPoint = () =>
    page.evaluate(() => {
      const host = [...document.body.children].find(
        (el) => el.tagName === 'DIV' && el.childElementCount === 0 && !el.textContent,
      );
      for (let dy = 6; dy < 120; dy += 6) {
        for (let dx = 6; dx < 320; dx += 6) {
          const x = window.innerWidth - dx;
          const y = window.innerHeight - dy;
          if (document.elementFromPoint(x, y) === host) return { x, y };
        }
      }
      return null;
    });

  /**
   * The box the overlay occupies, measured through hit tests.
   *
   * The shadow root is closed, so nothing inside it can be selected — but the region
   * that retargets to the host can be mapped, and its height says which surface is
   * showing. The pill is one row; the panel is most of a corner.
   */
  const overlayBox = () =>
    page.evaluate(() => {
      const host = [...document.body.children].find(
        (el) => el.tagName === 'DIV' && el.childElementCount === 0 && !el.textContent,
      );
      let minX = Infinity;
      let maxX = -1;
      let minY = Infinity;
      let maxY = -1;
      for (let y = window.innerHeight - 4; y > window.innerHeight - 560 && y > 0; y -= 4) {
        for (let x = window.innerWidth - 4; x > window.innerWidth - 420 && x > 0; x -= 4) {
          if (document.elementFromPoint(x, y) !== host) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      return maxX < 0 ? null : { minX, maxX, minY, maxY, height: maxY - minY };
    });

  /**
   * Collapsing and expanding are not the same click.
   *
   * Expanding means pressing the pill, which is the whole of what is on screen.
   * Collapsing means pressing the chevron at the top right of the panel's header —
   * a scan upward from the bottom corner lands on the control row instead and does
   * nothing, which is how the first version of this filed a photograph of the panel
   * under the name of the pill.
   */
  const setExpanded = async (want) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const box = await overlayBox();
      if (!box) return false;
      if (box.height > 120 === want) return true;
      const target = want
        ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
        : { x: box.maxX - 12, y: box.minY + 14 };
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(250);
    }
    const box = await overlayBox();
    return Boolean(box) && box.height > 120 === want;
  };

  await renderOverlay(idle);
  await page.waitForTimeout(150);
  const collapsed = await setExpanded(false);
  check('the overlay can be collapsed to its pill', collapsed, JSON.stringify(await overlayBox()));

  for (const [name, state] of overlayStates) {
    await renderOverlay(state);
    // Collapsed again after each render, not once before the loop. Capture starting
    // opens the panel by itself (overlay.ts, the `expanded = true` on the rising
    // edge of capturing), so photographing the recording PILL means undoing that
    // deliberately — the first version of this loop measured expansion once, then
    // filed a picture of the panel under the name of the pill.
    await page.waitForTimeout(150);
    if (!(await setExpanded(false))) {
      check(`the overlay can be collapsed for ${name}`, false, 'still expanded');
    }
    await save(page, 'overlay', name);
  }

  const expanded = await setExpanded(true);
  check('the overlay can be expanded to its panel', expanded, JSON.stringify(await overlayBox()));

  for (const [name, state] of panelStates) {
    await renderOverlay(state);
    await page.waitForTimeout(150);
    await save(page, 'overlay', name);
  }

  // A short viewport, because the panel is capped as a fraction of it and the row
  // carrying Stop is what gets cut when the transcript refuses to shrink. This is
  // the state the min-height rule exists for, and it is only visible in a picture.
  const tall = { ...idle, capturing: true, lines: [...turns, ...turns, ...turns] };
  await renderOverlay(tall);
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.waitForTimeout(200);
  await save(page, 'overlay', 'panel-short-viewport');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- popup ----------------------------------------------------------------
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const BASE_SETTINGS = {
    direction: 'en_to_vi',
    mode: 'cascade',
    voiceGender: 'female',
    reportMetrics: false,
    outbound: false,
  };

  const popupShot = async (name, options = {}) => {
    const {
      tabUrl = 'https://meet.google.com/abc-defg-hij',
      overlay = { capturing: false, lines: [], outbound: 'off', errors: {}, patched: true },
      permission = 'granted',
      settings = BASE_SETTINGS,
      sites = { enabled: true, disabledSites: [] },
      consentSeen = true,
      afterLoad,
    } = options;

    await worker.evaluate(
      async (seed) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
          'chatofy.settings': seed.settings,
          'chatofy.sites': seed.sites,
        });
        if (seed.consentSeen)
          await chrome.storage.local.set({ 'chatofy.recordingNoticeSeen': true });
      },
      { settings, sites, consentSeen },
    );

    const p = await context.newPage();
    // An init-script throw does not reject goto() and does not fail anything by
    // itself — measured. Without this listener, a stub that failed to install would
    // produce nine pictures of the wrong state with every check still green, which
    // is the outcome removing the swallowing catch was supposed to prevent.
    // Any uncaught error on the page, not only a stub that failed to install —
    // the name used to say otherwise, which would file a render crash under
    // "stubs installed" and send the next reader to the wrong place.
    //
    // Worth knowing what the stubs hand back: `sendMessage` resolves `undefined`
    // for every message type except `query`. Anything reading a field off that
    // result throws, and lands here.
    p.on('pageerror', (error) => {
      check(`no uncaught error on the popup page — ${name}`, false, String(error));
    });
    await p.setViewportSize({ width: 320, height: 600 });
    await p.addInitScript(
      (cfg) => {
        // Before the popup's own module runs, so the first render already sees these.
        // Deliberately unguarded: if any of the three cannot be replaced, every
        // picture after it shows the wrong state — and a set that is wrong is worse
        // than one that failed, because the failure gets fixed and the wrong set
        // gets signed off.
        chrome.tabs.query = () => Promise.resolve([{ id: 1, url: cfg.tabUrl, active: true }]);
        chrome.runtime.sendMessage = (message) =>
          Promise.resolve(message && message.type === 'query' ? cfg.overlay : undefined);
        navigator.permissions.query = () => Promise.resolve({ state: cfg.permission });
      },
      { tabUrl, overlay, permission },
    );

    await p.goto(popupUrl);
    // On the rendered marker, not on the clock. Every measurement below is taken
    // after this, and a fixed delay would take them mid-assembly on a slow runner
    // and call the result a pass.
    await p
      .waitForFunction(() => document.getElementById('toggle')?.textContent?.trim(), null, {
        timeout: 5_000,
      })
      .catch(() => {});
    if (afterLoad) await afterLoad(p);

    /*
     * Two measurements per state, and neither is allowed to pass on an empty page.
     *
     * `rendered` is the precondition. Without it the check below reports on a
     * document that never assembled — and reports it green, because an element
     * that is absent or zero-sized overflows by zero.
     *
     * `sideways` is the real subject. The settings pane scrolls vertically, and a
     * box that scrolls on one axis computes the other to "auto" as well, so
     * anything a single pixel too wide becomes a horizontal scrollbar under
     * content that has nowhere to go. It happened: a fieldset carries
     * "min-inline-size: min-content" in the UA sheet, "Runs on" holds three nowrap
     * platform details, and the group measured 327px inside a 288px column.
     *
     * The pane is legitimately absent during the consent step, which owns the
     * whole popup while it is up. That case is reported, not passed — a state
     * where nothing could be measured must not read the same as a state that was
     * measured and came out clean.
     */
    const state = await p.evaluate(() => {
      const toggle = document.getElementById('toggle');
      const pane = document.querySelector('main');
      const consent = document.getElementById('consent');
      return {
        rendered: Boolean(toggle?.textContent?.trim()),
        label: toggle?.textContent ?? '',
        consenting: Boolean(consent && !consent.hidden),
        pane: pane ? { over: pane.scrollWidth - pane.clientWidth, width: pane.clientWidth } : null,
      };
    });

    check(`the popup rendered — ${name}`, state.rendered, state.label || 'blank');

    if (!state.pane || state.pane.width === 0) {
      // Only the consent step may have no measurable pane. Anywhere else this is
      // the settings surface having failed to lay out, which is a finding.
      check(
        `the settings pane laid out — ${name}`,
        state.consenting,
        state.consenting ? 'consent step owns the popup' : 'pane missing or zero-width',
      );
      if (state.consenting) report(`sideways not measurable — ${name}`, 'consent step, no pane');
    } else {
      check(
        `the popup does not scroll sideways — ${name}`,
        state.pane.over <= 0,
        `${state.pane.width}px wide, overflowing by ${state.pane.over}px`,
      );
    }

    const file = await save(p, 'popup', name, { fullPage: true });
    await p.close();
    return file;
  };

  await popupShot('consent-unseen', { consentSeen: false });
  await popupShot('consent-just-dismissed', {
    consentSeen: false,
    // The state Start once fell below the fold in, and the reason the scroll fade
    // is re-measured here. Not the same as arriving with consent already given.
    afterLoad: async (p) => {
      await p.click('#consent-ok');
      await p.waitForTimeout(250);
    },
  });
  await popupShot('meeting-tab-idle');
  await popupShot('meeting-tab-recording', {
    overlay: { capturing: true, lines: [], outbound: 'off', errors: {}, patched: true },
  });
  await popupShot('non-meeting-tab', { tabUrl: 'https://example.com/' });
  await popupShot('zoom-desktop-tab', { tabUrl: 'https://zoom.us/j/9876543210' });
  await popupShot('microphone-notice', {
    settings: { ...BASE_SETTINGS, outbound: true },
    permission: 'prompt',
  });
  await popupShot('runs-on-switched-off', { sites: { enabled: false, disabledSites: [] } });
  // The tallest the pane gets: the platform list is shown on a tab that is not a
  // meeting, and the microphone notice sits above it.
  await popupShot('settings-scrolling', {
    tabUrl: 'https://example.com/',
    settings: { ...BASE_SETTINGS, outbound: true },
    permission: 'prompt',
  });

  writeFileSync(resolve(shotsDir, 'index.txt'), `${shots.length} states\n\n${shots.join('\n')}\n`);
  // Every state named above produced a file, and no file was produced that no
  // state asked for. Counting against a hard-coded total instead meant any state
  // added anywhere turned this red for a reason unrelated to what it guards.
  const duplicates = shots.filter((shot, index) => shots.indexOf(shot) !== index);
  check(
    'the screenshot set covers every state in the inventory',
    shots.length === new Set(shots).size && shots.length > 0,
    `${shots.length} written to e2e/screenshots${duplicates.length ? `, duplicated: ${duplicates.join(', ')}` : ''}`,
  );
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n${results.filter((r) => r.passed === true).length} passed, ${failures} failed`);
console.log(
  '\nStill a hand check, and why:\n' +
    '  - whether a meeting page can hide the overlay from OUTSIDE the shadow tree:\n' +
    '    `body { display: none }`, `body { content-visibility: hidden }` and a filter\n' +
    '    on `html` all work, and nothing in a shadow sheet can reach an ancestor. The\n' +
    '    filter is the worst of them — invisible overlay, passing hit test\n' +
    '  - the isolation checks above are the closest thing to coverage those\n' +
    '    invariants have. This suite does now run in CI (the `e2e` job), so they\n' +
    '    guard every PR rather than only the runs someone remembers to start\n' +
    '  - whether the grant given on the grant page is the one the OFFSCREEN document\n' +
    '    then uses: `--use-fake-ui-for-media-stream` accepts for every origin, so it\n' +
    '    cannot tell an inherited grant from an auto-accepted second prompt\n' +
    "  - whether Meet, Zoom and Facebook's own clients keep working: this serves\n" +
    '    its own page at their URLs, not their code\n' +
    '  - whether any of it sounds right, and what two directions cost one CPU',
);
process.exit(failures > 0 ? 1 : 0);
