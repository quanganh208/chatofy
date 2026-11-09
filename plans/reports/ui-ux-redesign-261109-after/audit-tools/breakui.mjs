// break-ui style pass: plausible worst-case data through the real API, then look and measure.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/break-ui`;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3001';
const b = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

async function session(email) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', process.env.UXAUDIT_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('#login-submit'),
  ]);
  return { ctx, page };
}

const clipped = () =>
  [...document.querySelectorAll('body *')]
    .filter((e) => {
      const cs = getComputedStyle(e);
      return (
        e.scrollWidth > e.clientWidth + 1 &&
        cs.overflowX !== 'visible' &&
        cs.textOverflow !== 'ellipsis' &&
        e.clientWidth > 0 &&
        (e.textContent || '').trim().length > 0
      );
    })
    .slice(0, 5)
    .map(
      (e) =>
        `${e.tagName.toLowerCase()} "${(e.textContent || '').trim().slice(0, 40)}" ${e.scrollWidth}>${e.clientWidth}`,
    );

const report = [];
for (const [label, email] of [
  ['long', 'nguyen.hoang.thien.phuc.anh.khoi@congtytnhhxuatnhapkhaumienbac.com.vn'],
  ['short', 'le@example.com'],
]) {
  const { ctx, page } = await session(email);
  for (const [vpName, w, h] of [
    ['1440', 1440, 900],
    ['375', 375, 812],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['/account', '/history', '/preferences']) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        rows: document.querySelectorAll('main a[href^="/history/"]').length,
      }));
      const cl = await page.evaluate(clipped);
      report.push({ who: label, vp: vpName, route, ...m, clipped: cl });
      await page.screenshot({
        path: `${OUT}/${label}-${route.slice(1)}-${vpName}.png`,
        fullPage: false,
      });
    }
  }
  if (label === 'long') {
    // The 300-turn meeting: open it from the list and time it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/history', { waitUntil: 'networkidle' });
    const links = await page.$$eval('main a[href^="/history/"]', (as) =>
      as.map((a) => a.getAttribute('href')),
    );
    report.push({ who: label, note: 'history list links', count: links.length });
    // Find the biggest by opening each of the last few quickly is slow; the 300-turn one is the newest (last seeded).
    const target = links[0];
    for (const [vpName, w, h] of [
      ['1440', 1440, 900],
      ['375', 375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      const t0 = Date.now();
      await page.goto(BASE + target, { waitUntil: 'networkidle' });
      const ms = Date.now() - t0;
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        turns: document.querySelectorAll('main li').length,
        dom: document.querySelectorAll('*').length,
        pageHeight: document.documentElement.scrollHeight,
      }));
      report.push({
        who: label,
        vp: vpName,
        route: 'detail ' + target.slice(0, 20),
        loadMs: ms,
        ...m,
      });
      await page.screenshot({ path: `${OUT}/long-detail-${vpName}.png`, fullPage: false });
    }
  }
  await ctx.close();
}
fs.writeFileSync(`${OUT}/break-ui-results.json`, JSON.stringify(report, null, 2));
for (const r of report) console.log(JSON.stringify(r));
await b.close();
