// Screenshots of the pre-join screen at the review viewports, both themes.
// Usage: VERIFY_PASSWORD=… node plans/261027-0850-conference-meet-style-prejoin/capture-prejoin-layout.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  '/home/quanganh208/Documents/QuangAnh/chatofy/apps/extension/package.json',
);
const { chromium } = require('playwright');
const WEB = 'http://localhost:3001';
const shots = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 1336, height: 768 },
  permissions: ['camera', 'microphone'],
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 90_000 });
await page.fill('#email', 'an3.prejoin@example.test');
await page.fill('#password', process.env.VERIFY_PASSWORD);
await page.click('#login-submit');
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
await page.goto(`${WEB}/conference`, { waitUntil: 'networkidle', timeout: 90_000 });
await page.getByRole('button', { name: 'New meeting' }).click();
await page.waitForSelector('#conf-name', { timeout: 60_000 });
await page.waitForTimeout(1500);

for (const [w, h, scheme] of [
  [1336, 768, 'dark'],
  [1440, 900, 'light'],
  [768, 1024, 'light'],
  [375, 812, 'dark'],
]) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(500);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const joinButton = page.getByRole('button', { name: 'Join now' });
  await joinButton.scrollIntoViewIfNeeded();
  console.log(
    `${w}x${h} ${scheme}: no h-scroll=${fits}, join visible=${await joinButton.isVisible()}`,
  );
  await page.screenshot({ path: join(shots, `prejoin-v3-${w}-${scheme}.png`) });
}
await page.setViewportSize({ width: 1336, height: 768 });
await page.click('[data-conference-voice-chip]');
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'prejoin-v3-1336-voice-open.png') });
await page.keyboard.press('Escape');
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.getByRole('button', { name: 'Turn off camera', exact: true }).click();
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, `prejoin-v3-1336-off-${scheme}.png`) });
  await page.getByRole('button', { name: 'Turn on camera', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  await page.waitForTimeout(300);
}
await browser.close();
