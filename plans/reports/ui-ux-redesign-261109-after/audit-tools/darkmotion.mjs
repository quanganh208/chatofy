// Dark mode axe (colour contrast) and reduced-motion check on every route.
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
const b = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ROUTES = [
  '/',
  '/login',
  '/register',
  '/translate/one-way',
  '/translate/two-way',
  '/conference',
  '/history',
  '/glossary',
  '/preferences',
  '/account',
];
const out = [];

async function run(label, opts) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('input[name=email]', 'le@example.com');
  await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('#login-submit'),
  ]);
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const finalPath = new URL(page.url()).pathname;
    const row = { mode: label, route, finalPath };
    if (label === 'dark') {
      await page.addScriptTag({ content: axeSource });
      const r = await page.evaluate(() =>
        axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }),
      );
      row.axe = r.violations.map(
        (v) =>
          `${v.id}:${v.impact}x${v.nodes.length}${v.id === 'color-contrast' ? ' e.g. ' + (v.nodes[0]?.html || '').slice(0, 70) : ''}`,
      );
    } else {
      row.running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              a.effect?.target &&
              !(a.effect.target.closest && a.effect.target.closest('[data-slot="skeleton"]')),
          )
          .map(
            (a) =>
              `${a.animationName || a.transitionProperty || 'anim'} on ${(a.effect.target.tagName || '').toLowerCase()}.${String(a.effect.target.className?.baseVal ?? a.effect.target.className).slice(0, 40)}`,
          )
          .slice(0, 4),
      );
    }
    out.push(row);
  }
  await ctx.close();
}
await run('dark', { colorScheme: 'dark' });
await run('reduced', { reducedMotion: 'reduce' });
fs.writeFileSync(
  `${REPO}/plans/reports/ui-ux-redesign-261109-after/dark-and-reduced-motion.json`,
  JSON.stringify(out, null, 2),
);
for (const r of out)
  console.log(
    r.mode,
    r.route,
    r.finalPath !== r.route ? '-> ' + r.finalPath : '',
    r.axe ? JSON.stringify(r.axe) : JSON.stringify(r.running),
  );
await b.close();
