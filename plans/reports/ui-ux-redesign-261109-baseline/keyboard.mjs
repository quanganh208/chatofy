// Phase 1.5: keyboard-only walk. Read-only. Tab through each page, record the focus
// order, whether a focus indicator is visible, and how many Tabs reach the primary action.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const BASE = 'http://localhost:3001';
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-baseline`;

const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('input[name=email]', process.env.UXAUDIT_EMAIL ?? 'uxaudit.test@example.com');
await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('#login-submit'),
]);

const describe = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow && cs.boxShadow !== 'none';
    const label = (
      el.getAttribute('aria-label') ||
      el.textContent ||
      el.getAttribute('placeholder') ||
      el.id ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      label,
      visibleRing: outline || !!shadow,
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
    };
  });

const ROUTES = [
  ['/', 'primary', /get started|sign in|start|translate/i],
  ['/login', 'primary', /continue|sign in|log in/i],
  ['/translate/one-way', 'primary', /start conversation/i],
  ['/translate/two-way', 'primary', /start/i],
  ['/conference', 'primary', /new meeting/i],
  ['/history', 'primary', /./],
  ['/glossary', 'primary', /./],
  ['/preferences', 'primary', /./],
  ['/account', 'primary', /./],
];
const results = [];
for (const [route, , primary] of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const order = [];
  let toPrimary = null;
  let noRing = 0;
  let offscreen = 0;
  const seen = new Map();
  let trapped = false;
  for (let i = 1; i <= 70; i++) {
    await page.keyboard.press('Tab');
    const d = await describe();
    if (!d) continue;
    const key = `${d.tag}|${d.label}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (seen.get(key) > 2) {
      trapped = true;
      break;
    }
    order.push({ i, ...d });
    if (!d.visibleRing) noRing++;
    if (!d.inViewport) offscreen++;
    if (toPrimary === null && primary.test(d.label) && (d.tag === 'button' || d.tag === 'a'))
      toPrimary = i;
  }
  results.push({
    route,
    focusStops: order.length,
    tabsToPrimary: toPrimary,
    stopsWithoutRing: noRing,
    stopsOffscreen: offscreen,
    loopedBack: trapped,
    firstStops: order.slice(0, 6).map((o) => `${o.i}:${o.tag}:${o.label}`),
    noRingSample: order
      .filter((o) => !o.visibleRing)
      .slice(0, 5)
      .map((o) => `${o.tag}:${o.label}`),
  });
}

// Task check: change language by keyboard on /preferences (reach the control, open it with Enter/Space).
fs.writeFileSync(`${OUT}/keyboard-results.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(
  JSON.stringify(
    results.map((r) => ({
      route: r.route,
      stops: r.focusStops,
      toPrimary: r.tabsToPrimary,
      noRing: r.stopsWithoutRing,
      off: r.stopsOffscreen,
      loop: r.loopedBack,
    })),
    null,
    0,
  ),
);
