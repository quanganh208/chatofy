// Capture every /conference screen state at the review viewports, with metrics.
// Usage: AN_EMAIL=… BINH_EMAIL=… VERIFY_PASSWORD=… node capture-conference.mjs <round-dir>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(
  '/home/quanganh208/Documents/QuangAnh/chatofy/apps/extension/package.json',
);
const { chromium } = require('playwright');
const WEB = 'http://localhost:3001';
const OUT = resolve(process.argv[2]);
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['tablet', 768, 1024],
  ['mobile', 375, 812],
];
const metrics = [];

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
async function account(email) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  page.consoleErrors = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && page.consoleErrors.push(m.text().slice(0, 160)),
  );
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.fill('#email', email);
  await page.fill('#password', process.env.VERIFY_PASSWORD);
  await page.click('#login-submit');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return page;
}

/** Facts a screenshot cannot prove, read off the live DOM. */
async function measure(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const controls = [
      ...document.querySelectorAll(
        'main button, main a, main [role=radio], main input, main [role=combobox]',
      ),
    ].filter(visible);
    const small = controls
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 24 || r.height < 24)
      .map(
        ({ el, r }) =>
          `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`,
      );
    const unnamed = [...document.querySelectorAll('main button')]
      .filter(visible)
      .filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim())).length;
    return {
      hScroll: document.documentElement.scrollWidth > window.innerWidth,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      title: document.title,
      small,
      unnamed,
    };
  });
}

async function shoot(page, name) {
  for (const [label, w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${label}-${name}.png`) });
    metrics.push({ page: name, viewport: label, ...(await measure(page)) });
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(300);
  metrics.push({ page: name, viewport: 'reflow-320', ...(await measure(page)) });
  await page.setViewportSize({ width: 1440, height: 900 });
}

try {
  const a = await account(process.env.AN_EMAIL);
  await a.goto(`${WEB}/conference`, { waitUntil: 'networkidle', timeout: 90_000 });
  await shoot(a, 'landing');

  // Keyboard: what the first Tab stops land on inside main, and whether focus shows.
  await a
    .locator('main')
    .focus()
    .catch(() => {});
  const tabStops = [];
  for (let i = 0; i < 4; i += 1) {
    await a.keyboard.press('Tab');
    tabStops.push(
      await a.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)} outline=${style.outlineStyle !== 'none' || style.boxShadow !== 'none'}`;
      }),
    );
  }
  metrics.push({ page: 'landing', viewport: 'keyboard', tabStops });

  await a.fill('#conf-room', 'not a room');
  await a.getByRole('button', { name: 'Join', exact: true }).click();
  await shoot(a, 'landing-bad-code');

  await a.goto(`${WEB}/conference/cl9ebqhxk00003b600tymydho`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await a.getByRole('button', { name: 'Join now' }).click();
  await a.waitForTimeout(4000);
  await shoot(a, 'room-not-found');

  await a.goto(`${WEB}/conference`, { waitUntil: 'networkidle', timeout: 90_000 });
  await a.getByRole('button', { name: 'New meeting' }).click();
  await a.waitForSelector('#conf-name', { timeout: 60_000 });
  const roomUrl = a.url();
  await a.waitForTimeout(1200);
  await shoot(a, 'prejoin');
  await a.getByRole('button', { name: 'Join now' }).click();
  await a.getByRole('button', { name: 'Leave' }).waitFor({ timeout: 30_000 });
  await a.waitForTimeout(1500);
  await shoot(a, 'in-call-alone');

  const b = await account(process.env.BINH_EMAIL);
  await b.goto(roomUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  await b.getByRole('button', { name: 'Join now' }).click();
  await b.getByRole('button', { name: 'Leave' }).waitFor({ timeout: 30_000 });
  await a.getByText('Binh').first().waitFor({ timeout: 30_000 });
  await a.waitForTimeout(2500);
  await shoot(a, 'in-call-two');

  await b.getByRole('button', { name: 'Leave' }).click();
  await b.waitForURL(/\/ended/, { timeout: 30_000 });
  await b.waitForTimeout(2500);
  await shoot(b, 'ended');

  writeFileSync(
    join(OUT, 'metrics.json'),
    JSON.stringify({ metrics, console: { a: a.consoleErrors, b: b.consoleErrors } }, null, 2),
  );
  console.log('captured', metrics.length, 'rows');
} catch (err) {
  writeFileSync(
    join(OUT, 'metrics.json'),
    JSON.stringify({ metrics, error: String(err) }, null, 2),
  );
  console.log('FAILED', String(err).split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
