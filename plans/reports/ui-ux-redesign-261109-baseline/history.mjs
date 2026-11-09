// Phase 1.6: worst-case data on /history and /history/[id]. Needs seed.mjs run first.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = 'http://localhost:3001';
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-baseline`;
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 },
  { name: '320', width: 320, height: 640 },
];

const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)));

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('input[name=email]', process.env.UXAUDIT_EMAIL ?? 'uxaudit.test@example.com');
await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('#login-submit'),
]);

await page.goto(BASE + '/history', { waitUntil: 'networkidle' });
const hrefs = await page.$$eval('a[href^="/history/"]', (as) => [
  ...new Set(as.map((a) => a.getAttribute('href'))),
]);
console.log('history links:', hrefs.length);

const measure = () =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    // The transcript text column: the narrowest wide-ish block that holds long prose.
    const blocks = [
      ...document.querySelectorAll('main p, main [class*=turn], main li, main blockquote'),
    ].filter((e) => (e.textContent || '').trim().length > 80);
    const widths = blocks
      .map((e) => Math.round(e.getBoundingClientRect().width))
      .filter((w) => w > 0);
    const clipped = [...document.querySelectorAll('main *')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1;
    }).length;
    return {
      overflow: doc.scrollWidth > vw + 1,
      scrollWidth: doc.scrollWidth,
      h1: document.querySelectorAll('h1').length,
      minTextColumn: widths.length ? Math.min(...widths) : null,
      elementsPastRightEdge: clipped,
    };
  });

const results = [];
const routes = ['/history', ...hrefs];
for (const route of routes) {
  const slug =
    route === '/history' ? 'history-seeded' : 'history-detail-' + (hrefs.indexOf(route) + 1);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const m = await measure();
    const shot = `shots/${slug}-${vp.name}.png`;
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: route !== '/history' });
    const row = { route, vp: vp.name, shot, ...m };
    if (vp.name === '1440' || vp.name === '375') {
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(() =>
        axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }),
      );
      row.axe = axe.violations.map((v) => `${v.id}:${v.impact}x${v.nodes.length}`);
    }
    results.push(row);
  }
}
fs.writeFileSync(
  `${OUT}/history-results.json`,
  JSON.stringify({ results, consoleErrors }, null, 2),
);
await browser.close();
for (const r of results)
  console.log(
    r.route.slice(0, 40),
    r.vp,
    r.overflow ? 'OVERFLOW ' + r.scrollWidth : 'ok',
    'h1=' + r.h1,
    'textCol=' + r.minTextColumn,
    'past=' + r.elementsPastRightEdge,
    r.axe ? JSON.stringify(r.axe) : '',
  );
