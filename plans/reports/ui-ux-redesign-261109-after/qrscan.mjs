// Prove the on-page QR code scans: screenshot it, decode with an independent reader (jsQR), compare.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/qr`;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3001';
const b = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function run(theme, vp) {
  const ctx = await b.newContext({
    viewport: vp,
    colorScheme: theme,
    permissions: ['camera', 'microphone'],
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('input[name=email]', 'uxaudit.a@example.com');
  await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('#login-submit'),
  ]);
  await page.goto(BASE + '/conference', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /new meeting/i }).click();
  await page.waitForURL(/\/conference\/[^/]+/, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /join now/i }).click();
  await page.waitForTimeout(7000);
  const expected = page.url();
  await page.getByRole('button', { name: 'Show QR code' }).click();
  await page.waitForTimeout(600);
  const svg = page.locator('svg[role="img"][aria-label="QR code to join the meeting"]');
  const png = await svg.screenshot({ path: `${OUT}/qr-${theme}-${vp.width}.png` });
  await page.screenshot({ path: `${OUT}/popover-${theme}-${vp.width}.png` });
  const img = PNG.sync.read(png);
  const result = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  console.log(
    `${theme} ${vp.width}px: decoded=${result ? result.data : 'NONE'} | matches page url: ${result?.data === expected}`,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  console.log('   overflow:', overflow);
  await ctx.close();
}
await run('light', { width: 1440, height: 900 });
await run('dark', { width: 1440, height: 900 });
await run('light', { width: 375, height: 812 });
await b.close();
