// Real-browser check of the two resize handles: mouse drag, keyboard, double click, persistence.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/resize`;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3001';
const b = await pw.chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function login(email) {
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
  });
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
const log = (...a) => console.log(...a);

// ---- Sidebar
const A = await login('uxaudit.a@example.com');
const p = A.page;
await p.goto(BASE + '/history', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const width = async () => {
  await p.waitForTimeout(400);
  return p.evaluate(() =>
    Math.round(
      document.querySelector('[data-slot="sidebar-container"]').getBoundingClientRect().width,
    ),
  );
};
const handle = p.locator('[role="separator"][aria-label="Sidebar width"]');
log('sidebar default width', await width(), 'handle count', await handle.count());
const box = await handle.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + 300);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2 + 90, box.y + 300, { steps: 6 });
await p.screenshot({ path: `${OUT}/sidebar-dragging.png` });
await p.mouse.up();
log('after drag +90 ->', await width(), 'aria', await handle.getAttribute('aria-valuenow'));
await handle.focus();
await p.keyboard.press('ArrowLeft');
await p.keyboard.press('ArrowLeft');
log('after 2x ArrowLeft ->', await width());
await p.keyboard.press('End');
log('End ->', await width(), '(max 360)');
await p.keyboard.press('Home');
log('Home ->', await width(), '(min 200)');
await p.keyboard.press('Shift+ArrowRight');
const widthBeforeReload = await width();
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(800);
log('reloaded: remembered', widthBeforeReload, '->', await width());
await p.screenshot({ path: `${OUT}/sidebar-remembered.png` });
await handle.dblclick();
log('double click ->', await width(), '(default 256)');
// Mobile: no handle.
await p.setViewportSize({ width: 375, height: 812 });
await p.waitForTimeout(500);
log(
  '375px handle count',
  await p.locator('[role="separator"][aria-label="Sidebar width"]').count(),
);
await p.setViewportSize({ width: 1440, height: 900 });
// Rail route: no handle.
await p.goto(BASE + '/translate/one-way', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
log(
  'translate (rail) handle count',
  await p.locator('[role="separator"][aria-label="Sidebar width"]').count(),
);

// ---- Chat panel in a room
await p.goto(BASE + '/conference', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /new meeting/i }).click();
await p.waitForURL(/\/conference\/[^/]+/, { timeout: 30000 });
await p.waitForTimeout(3000);
await p.getByRole('button', { name: /join now/i }).click();
await p.waitForTimeout(8000);
const aside = p.locator('aside');
const asideW = () => aside.evaluate((e) => Math.round(e.getBoundingClientRect().width));
const ch = p.locator('[role="separator"][aria-label="Chat panel width"]');
log('chat default width', await asideW(), 'handle count', await ch.count());
const cb = await ch.boundingBox();
await p.mouse.move(cb.x + cb.width / 2, cb.y + 300);
await p.mouse.down();
await p.mouse.move(cb.x + cb.width / 2 - 120, cb.y + 300, { steps: 6 });
await p.mouse.up();
log('chat after drag -120 ->', await asideW(), 'aria', await ch.getAttribute('aria-valuenow'));
await p.mouse.move(cb.x, cb.y + 300);
await ch.focus();
await p.keyboard.press('End');
log('chat End ->', await asideW(), '(max min(480, half window = 720) = 480)');
await p.keyboard.press('Home');
log('chat Home ->', await asideW(), '(min 240)');
await p.keyboard.press('Shift+ArrowLeft');
await p.screenshot({ path: `${OUT}/chat-resized.png` });
const noOverflow = await p.evaluate(
  () => document.documentElement.scrollWidth <= window.innerWidth + 1,
);
log('no horizontal overflow in the room:', noOverflow);
await p.setViewportSize({ width: 600, height: 900 });
await p.waitForTimeout(600);
log('600px chat handle visible:', await ch.isVisible());
await b.close();
