/**
 * Refuses to package an extension that does not know where the API is.
 *
 * WXT deliberately tolerates a missing URL and falls back to localhost, because CI
 * compiles this on every push with no environment configured and a failure there
 * would say nothing useful. That tolerance is exactly what makes a release check
 * necessary: without one, the fallback ships.
 *
 * Runs as `prezip`, so it guards `pnpm --filter extension zip` — the only release
 * path in this package.
 */
// Node does not read .env; the compiler's own tooling does. Without this the guard
// rejects precisely the developer who followed the instruction in its error message,
// and accepts nobody who used the file it points at. An absent file is the normal
// case in CI, where the value is exported instead.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env here. Either the value is already exported, or it is missing and the
  // checks below are about to say so.
}

const url = process.env.WXT_API_BASE_URL;

if (!url) {
  console.error(
    '\nWXT_API_BASE_URL is not set.\n\n' +
      'A packaged extension carries this URL; there is no field in the popup to\n' +
      'correct it after install. Set it in apps/extension/.env (see .env.example)\n' +
      'or in the release environment, then package again.\n',
  );
  process.exit(1);
}

// A localhost release is the specific accident this exists to stop: it is what a
// developer's own .env holds, and it is the value WXT falls back to.
if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)) {
  console.error(
    `\nWXT_API_BASE_URL points at ${url}.\n\n` +
      'That host does not exist on the machine this would be installed on. Set a\n' +
      'reachable URL before packaging.\n',
  );
  process.exit(1);
}
