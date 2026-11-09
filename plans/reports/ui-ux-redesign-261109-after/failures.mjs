// Task C: what the user sees when the API is down, returns 500, or the network drops.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/failures`;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3001';
const ROUTES = [
  '/translate/one-way',
  '/history',
  '/glossary',
  '/preferences',
  '/account',
  '/conference',
];
const MODES = ['api-down', 'api-500', 'offline'];

const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const rows = [];

for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', 'uxaudit.a@example.com');
  await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('#login-submit'),
  ]);
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' }); // warm, signed in

  if (mode === 'api-down')
    await ctx.route('http://localhost:3000/**', (r) => r.abort('connectionrefused'));
  if (mode === 'api-500')
    await ctx.route('http://localhost:3000/**', (r) =>
      r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        }),
      }),
    );

  for (const route of ROUTES) {
    const errs = [];
    const onErr = (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120));
    page.on('console', onErr);
    try {
      if (mode === 'offline') {
        // Client-side navigation through the sidebar, then drop the network.
        await ctx.setOffline(false);
        await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
        await ctx.setOffline(true);
        const link = page.locator(`a[href="${route}"]`).first();
        await link.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3500);
      } else {
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2500);
      }
    } catch (e) {
      rows.push({ mode, route, nav: 'ERR ' + String(e).slice(0, 80) });
      page.off('console', onErr);
      continue;
    }
    const info = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        url: location.pathname,
        h1: document.querySelectorAll('h1').length,
        alerts: [...document.querySelectorAll('[role=alert]')].map((a) =>
          a.textContent.trim().slice(0, 100),
        ),
        skeletons: document.querySelectorAll('[data-slot=skeleton]').length,
        text: text.slice(0, 260),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const slug = `${mode}-${route.replace(/^\//, '').replace(/\//g, '-')}`;
    await page.screenshot({ path: `${OUT}/${slug}.png` });
    rows.push({ mode, route, ...info, consoleErrors: errs.length });
    page.off('console', onErr);
  }
  await ctx.setOffline(false);
  await ctx.close();
}
fs.writeFileSync(`${OUT}/failures-results.json`, JSON.stringify(rows, null, 2));
for (const r of rows) {
  console.log(
    `[${r.mode}] ${r.route} -> ${r.url ?? r.nav} h1=${r.h1} alerts=${JSON.stringify(r.alerts)} skel=${r.skeletons} overflow=${r.overflow}\n    "${(r.text ?? '').slice(0, 170)}"`,
  );
}
await browser.close();
