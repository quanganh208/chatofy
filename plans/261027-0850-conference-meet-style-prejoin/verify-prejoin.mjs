// Phase 5 browser check of the Meet-style landing and pre-join room.
// Two throwaway local accounts, one Chromium context each, fake camera + mic.
// Usage: node plans/261027-0850-conference-meet-style-prejoin/verify-prejoin.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  '/home/quanganh208/Documents/QuangAnh/chatofy/apps/extension/package.json',
);
const { chromium } = require('playwright');

const WEB = 'http://localhost:3001';
const PASSWORD = process.env.VERIFY_PASSWORD;
const shots = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const contextOptions = {
  viewport: { width: 1440, height: 900 },
  permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
};

async function signIn(page, email) {
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('#login-submit');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

try {
  // ---- user A ----
  const ctxA = await browser.newContext(contextOptions);
  const a = await ctxA.newPage();
  await a.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 90_000 });
  await signIn(a, 'an.prejoin@example.test');

  await a.goto(`${WEB}/conference`, { waitUntil: 'networkidle', timeout: 90_000 });
  check(
    'landing says Joining as An Nguyen',
    (await a.textContent('body')).includes('Joining as An Nguyen'),
  );
  check('landing has no name field', (await a.locator('#conf-name').count()) === 0);
  await a.screenshot({ path: join(shots, 'landing-1440.png') });

  await a.getByRole('button', { name: 'New meeting' }).click();
  await a.waitForURL(/\/conference\/[a-z0-9]+$/, { timeout: 60_000 });
  const roomUrl = a.url();
  check(
    'new meeting lands on the bare room URL',
    /^http:\/\/localhost:3001\/conference\/[a-z0-9]+$/.test(roomUrl),
    roomUrl,
  );
  await a.waitForSelector('#conf-name', { timeout: 60_000 });
  check('name prefilled from the account', (await a.inputValue('#conf-name')) === 'An Nguyen');
  const meterMoved = await a
    .waitForFunction(
      () => Number(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')) > 0,
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check('mic meter moves', meterMoved);
  await a.screenshot({ path: join(shots, 'prejoin-1440.png') });

  await a.click('[data-conference-voice-chip]');
  await a.getByRole('radio', { name: 'Male', exact: true }).click();
  await a.getByRole('radio', { name: '1.25×', exact: true }).click();
  const chip = await a.textContent('[data-conference-voice-chip]');
  check('voice chip shows Male · 1.25', chip.includes('Male') && chip.includes('1.25'), chip);
  await a.screenshot({ path: join(shots, 'prejoin-voice-open-1440.png') });
  await a.keyboard.press('Escape');

  // The same store /translate reads. Navigating away flushes the debounced save.
  await a.goto(`${WEB}/translate`, { waitUntil: 'networkidle', timeout: 90_000 });
  await a.click('button[aria-label^="Voice settings"]');
  const speedChecked = await a
    .getByRole('radio', { name: '1.25×', exact: true })
    .getAttribute('aria-checked');
  check(
    '/translate sees the speed chosen in the room',
    speedChecked === 'true',
    `aria-checked=${speedChecked}`,
  );
  await a.keyboard.press('Escape');

  await a.goto(roomUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await a.getByRole('button', { name: 'Join now' }).click();
  const inCall = await a
    .getByRole('button', { name: 'Leave' })
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check('Join now enters the call', inCall);

  await a.getByRole('button', { name: 'Copy invite link' }).click();
  const copied = await a.evaluate(() => navigator.clipboard.readText());
  check('invite link is the bare room URL', copied === roomUrl, copied);
  await a.screenshot({ path: join(shots, 'in-call-1440.png') });

  // ---- user B: signed out, opens the shared link ----
  const ctxB = await browser.newContext(contextOptions);
  const b = await ctxB.newPage();
  await b.goto(roomUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  const loginUrl = new URL(b.url());
  check(
    'signed-out link goes to login with next',
    loginUrl.pathname === '/login' &&
      (loginUrl.searchParams.get('next') ?? '').includes('/conference/'),
    b.url(),
  );
  await signIn(b, 'binh.prejoin@example.test');
  await b.waitForSelector('#conf-name', { timeout: 90_000 });
  check('sign-in returns to the same room', b.url() === roomUrl, b.url());
  check('B name prefilled', (await b.inputValue('#conf-name')) === 'Binh Tran');

  // ---- viewports (B, before joining) ----
  for (const [w, h] of [
    [768, 1024],
    [375, 812],
  ]) {
    await b.setViewportSize({ width: w, height: h });
    await b.waitForTimeout(300);
    check(`prejoin ${w} has no horizontal scroll`, await noHorizontalScroll(b));
    const joinButton = b.getByRole('button', { name: 'Join now' });
    await joinButton.scrollIntoViewIfNeeded();
    check(`prejoin ${w} Join now reachable`, await joinButton.isVisible());
    await b.screenshot({ path: join(shots, `prejoin-${w}.png`), fullPage: true });
  }
  const landing = await ctxB.newPage();
  for (const [w, h] of [
    [768, 1024],
    [375, 812],
  ]) {
    await landing.setViewportSize({ width: w, height: h });
    await landing.goto(`${WEB}/conference`, { waitUntil: 'networkidle', timeout: 90_000 });
    check(`landing ${w} has no horizontal scroll`, await noHorizontalScroll(landing));
    await landing.screenshot({ path: join(shots, `landing-${w}.png`), fullPage: true });
  }
  await landing.close();

  await b.setViewportSize({ width: 1440, height: 900 });
  await b.getByRole('button', { name: 'Join now' }).click();
  const seen = await a
    .getByText('Binh Tran')
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check('A sees Binh Tran join', seen);
  await a.screenshot({ path: join(shots, 'in-call-two-1440.png') });
} catch (err) {
  check('script ran to the end', false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
