// Real-browser check of the in-call "Captions and sound" menu with two people in a room.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const REPO = 'E:/PTIT/DATN/chatofy';
const pw = await import(
  pathToFileURL(
    `${REPO}/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs`,
  ).href
);
const OUT = `${REPO}/plans/reports/ui-ux-redesign-261109-after/listening`;
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
  return page;
}
const A = await login('uxaudit.a@example.com');
const B = await login('uxaudit.b@example.com');
await A.goto(BASE + '/conference', { waitUntil: 'networkidle' });
await A.getByRole('button', { name: /new meeting/i }).click();
await A.waitForURL(/\/conference\/[^/]+/, { timeout: 30000 });
await A.waitForTimeout(3000);
const room = A.url();
await A.getByRole('button', { name: /join now/i }).click();
await B.goto(BASE + '/conference', { waitUntil: 'networkidle' });
await B.fill('input[placeholder*="link" i], input[placeholder*="code" i]', room);
await B.getByRole('button', { name: /^join$/i }).click();
await B.waitForTimeout(4000);
await B.getByRole('button', { name: /join now/i }).click();
await A.waitForTimeout(9000);

const log = (...a) => console.log(...a);
const peerVideo = () =>
  A.evaluate(() => {
    const v = [...document.querySelectorAll('video')];
    return v.length > 1
      ? { volume: Math.round(v[1].volume * 100) / 100, muted: v[1].muted, count: v.length }
      : { count: v.length };
  });
log('before menu', JSON.stringify(await peerVideo()));

const trigger = A.getByRole('button', { name: 'Captions and sound' });
log('menu button visible:', await trigger.isVisible());
await trigger.click();
await A.waitForTimeout(500);
await A.screenshot({ path: `${OUT}/menu-open.png` });
const sw = A.getByRole('switch', { name: 'Show captions' });
log('captions switch checked:', await sw.getAttribute('aria-checked'));
// Volume: focus the slider thumb and press keys.
const slider = A.getByRole('slider', { name: 'Original voices volume' });
await slider.focus();
for (let i = 0; i < 30; i++) await A.keyboard.press('ArrowLeft'); // 30 x 1% = 70%
await A.waitForTimeout(300);
log(
  'after 30x ArrowLeft',
  JSON.stringify(await peerVideo()),
  'aria',
  await slider.getAttribute('aria-valuenow'),
);
await A.keyboard.press('Home');
await A.waitForTimeout(300);
log('Home (0)', JSON.stringify(await peerVideo()));
// Size choice
await A.getByRole('radio', { name: 'XL', exact: true }).click();
log(
  'XL checked:',
  await A.getByRole('radio', { name: 'XL', exact: true }).getAttribute('aria-checked'),
);
// Captions off, size disabled
await sw.click();
log(
  'captions after click:',
  await sw.getAttribute('aria-checked'),
  '| size disabled:',
  await A.getByRole('radio', { name: 'M', exact: true }).isDisabled(),
);
await A.screenshot({ path: `${OUT}/menu-captions-off.png` });
await A.keyboard.press('Escape');
// Reload: remembered.
await A.reload({ waitUntil: 'networkidle' });
await A.waitForTimeout(500);
const stored = await A.evaluate(() => localStorage.getItem('chatofy.call-preferences'));
log('stored after reload:', stored);
await b.close();
