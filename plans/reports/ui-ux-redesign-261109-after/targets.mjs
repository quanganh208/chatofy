// List interactive controls under 44px on a route, with touch emulation at 375px.
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const routes = process.argv.slice(2);
const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
await page.fill('input[name=email]', 'uxaudit.a@example.com');
await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD ?? '');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('#login-submit'),
]);
for (const route of routes) {
  await page.goto('http://localhost:3001' + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=radio], [role=combobox], [role=slider]',
      ),
    ]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (
          r.width === 0 ||
          r.height === 0 ||
          cs.visibility === 'hidden' ||
          el.id === 'skip' ||
          (el.textContent || '').trim() === 'Skip to content'
        )
          return null;
        if (r.width >= 44 && r.height >= 44) return null;
        const label = (
          el.getAttribute('aria-label') ||
          el.textContent ||
          el.getAttribute('placeholder') ||
          el.id ||
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 30);
        return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`;
      })
      .filter(Boolean),
  );
  console.log(`\n${route}: ${small.length} under 44px`);
  for (const s of small) console.log('  ' + s);
}
await browser.close();
