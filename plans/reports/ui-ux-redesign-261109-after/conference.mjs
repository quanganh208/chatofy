// Task A: live conference with two accounts, fake media, resized live (per the checklist).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/conference`;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3001';
const pass = process.env.UXAUDIT_PASSWORD ?? '';

const browser = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function signedIn(email) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
  });
  const page = await ctx.newPage();
  page.on(
    'console',
    (m) => m.type() === 'error' && (page._errs ??= []).push(m.text().slice(0, 140)),
  );
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pass);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('#login-submit'),
  ]);
  return { ctx, page };
}

const A = await signedIn('uxaudit.a@example.com');
const B = await signedIn('uxaudit.b@example.com');
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
};

await A.page.goto(BASE + '/conference', { waitUntil: 'networkidle' });
await A.page.getByRole('button', { name: /new meeting/i }).click();
await A.page
  .waitForURL(/\/conference\/[^/]+/, { timeout: 30000 })
  .catch(() => note('A: did not reach a room URL'));
await A.page.waitForTimeout(4000);
const roomUrl = A.page.url();
note('A room url: ' + roomUrl);
await A.page.screenshot({ path: `${OUT}/lobby-a-1440.png` });
await A.page.setViewportSize({ width: 375, height: 812 });
await A.page.waitForTimeout(800);
const joinBox = await A.page.getByRole('button', { name: /join now/i }).boundingBox();
note('lobby 375: Join now bottom=' + Math.round(joinBox.y + joinBox.height) + ' viewport=812');
await A.page.setViewportSize({ width: 1440, height: 900 });
await A.page.getByRole('button', { name: /join now/i }).click();
await A.page.waitForTimeout(9000);
await A.page.screenshot({ path: `${OUT}/room-a-alone-1440.png` });

// B joins with the link.
await B.page.goto(BASE + '/conference', { waitUntil: 'networkidle' });
await B.page.fill('input[placeholder*="link" i], input[placeholder*="code" i]', roomUrl);
await B.page.getByRole('button', { name: /^join$/i }).click();
await B.page.waitForTimeout(6000);
note('B url after join: ' + B.page.url());
await B.page.getByRole('button', { name: /join now/i }).click();
await B.page.waitForTimeout(10000);
await B.page.screenshot({ path: `${OUT}/room-b-joined-1440.png` });
note(
  'A buttons: ' +
    JSON.stringify(
      await A.page.$$eval('button', (bs) =>
        bs
          .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 25),
      ),
    ),
);

// Resize A live through the four widths (catches state chosen once at mount).
const VPS = [
  ['1440', 1440, 900],
  ['768', 768, 1024],
  ['375', 375, 812],
  ['320', 320, 640],
  ['1440b', 1440, 900],
];
const rows = [];
for (const [name, w, h] of VPS) {
  await A.page.setViewportSize({ width: w, height: h });
  await A.page.waitForTimeout(1200);
  const m = await A.page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    h1: document.querySelectorAll('h1').length,
    videos: document.querySelectorAll('video').length,
    small: [...document.querySelectorAll('button, a[href], input, [role=button]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.width < 44 || r.height < 44);
    }).length,
  }));
  rows.push({ vp: name, ...m });
  await A.page.screenshot({ path: `${OUT}/room-a-${name}.png` });
}
note(JSON.stringify(rows));

// A leaves: find a leave / end button.
const leave = A.page.getByRole('button', { name: /^leave$/i }).first();
if (await leave.count()) {
  await A.page.setViewportSize({ width: 1440, height: 900 });
  await leave.click();
  await A.page.waitForTimeout(2500);
  const confirm = A.page.getByRole('button', { name: /^(leave|end|confirm)/i }).last();
  if (await confirm.count()) await confirm.click().catch(() => {});
  await A.page.waitForTimeout(4000);
  note('A url after leave: ' + A.page.url());
  for (const [name, w, h] of VPS.slice(0, 4)) {
    await A.page.setViewportSize({ width: w, height: h });
    await A.page.waitForTimeout(600);
    await A.page.screenshot({ path: `${OUT}/after-leave-${name}.png` });
  }
} else note('no leave button found');

note('A console errors: ' + JSON.stringify(A.page._errs ?? []).slice(0, 400));
note('B console errors: ' + JSON.stringify(B.page._errs ?? []).slice(0, 400));
fs.writeFileSync(`${OUT}/conference-results.json`, JSON.stringify({ log, rows }, null, 2));
await browser.close();
