// Screenshot chosen routes at the three review viewports into the "after" folder.
// Usage: node shots.mjs /translate/one-way /glossary ...
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = process.env.OUT;
fs.mkdirSync(OUT, { recursive: true });
const routes = process.argv.slice(2);
const VPS = [
  ['1440', 1440, 900],
  ['768', 768, 1024],
  ['375', 375, 812],
  ['320', 320, 640],
];
const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
await page.fill('input[name=email]', process.env.UXAUDIT_EMAIL ?? 'uxaudit.test@example.com');
await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('#login-submit'),
]);
for (const route of routes) {
  const slug = route.replace(/^\//, '').replace(/\//g, '-') || 'home';
  for (const [name, w, h] of VPS) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('http://localhost:3001' + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    await page.screenshot({
      path: `${OUT}/${slug}-${name}.png`,
      fullPage: process.env.FULL === '1',
    });
    console.log(route, name, overflow ? 'OVERFLOW' : 'ok');
  }
}
await browser.close();
