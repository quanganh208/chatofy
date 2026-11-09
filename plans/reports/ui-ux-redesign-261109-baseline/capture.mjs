// Read-only baseline capture for the UI/UX redesign plan (phase 1.3-1.6).
// One browser context so rotating refresh tokens stay valid.
import fs from 'node:fs';
import path from 'node:path';
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
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const PUBLIC = ['/', '/login', '/register'];
const SIGNED_IN = [
  '/translate/one-way',
  '/translate/two-way',
  '/conference',
  '/history',
  '/glossary',
  '/preferences',
  '/account',
];
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 },
  { name: '320', width: 320, height: 640 },
];
const slug = (r) => (r === '/' ? 'home' : r.replace(/^\//, '').replace(/\//g, '-'));

const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = {};
let current = '';
page.on('console', (m) => {
  if (m.type() === 'error') (consoleErrors[current] ??= []).push(m.text().slice(0, 200));
});

const results = [];

async function measure(route, vp) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const overflow = doc.scrollWidth > vw + 1;
    const h1 = document.querySelectorAll('h1').length;
    const small = [];
    document
      .querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]',
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return;
        if (r.width < 44 || r.height < 44) {
          small.push(
            `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      });
    return {
      overflow,
      scrollWidth: doc.scrollWidth,
      h1,
      smallTargets: small.length,
      smallSample: small.slice(0, 6),
    };
  });
}

async function visit(route) {
  for (const vp of VIEWPORTS) {
    current = `${route}@${vp.name}`;
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      results.push({ route, vp: vp.name, error: String(e).slice(0, 160) });
      continue;
    }
    await page.waitForTimeout(500);
    const finalPath = new URL(page.url()).pathname;
    const m = await measure(route, vp);
    const shot = `shots/${slug(route)}-${vp.name}.png`;
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
    const row = { route, vp: vp.name, finalPath, shot, ...m };
    if (vp.name === '1440') {
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(async () =>
        // eslint-disable-next-line no-undef
        axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }),
      );
      row.axe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    }
    results.push(row);
  }
}

for (const r of PUBLIC) await visit(r);

// Sign in through the real form (1440 viewport).
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('input[name=email]', process.env.UXAUDIT_EMAIL ?? 'uxaudit.test@example.com');
await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('#login-submit'),
]);
console.log('after login:', new URL(page.url()).pathname);

for (const r of SIGNED_IN) await visit(r);

fs.writeFileSync(
  `${OUT}/capture-results.json`,
  JSON.stringify({ results, consoleErrors }, null, 2),
);
await browser.close();
console.log('done', results.length, 'rows');
