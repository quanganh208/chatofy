// The Gemini API key for the scripts in this harness, without ever printing it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

/**
 * Read from the environment first; otherwise lifted out of the repo-root `.env`,
 * which is where this repo keeps it. Only the FIRST of a comma-separated pool is
 * used: these scripts open a handful of sessions and have no reason to spread
 * them, and a live session holds one key for its whole length anyway.
 *
 * Returns `null` when no key is found, so each caller decides how loudly to fail.
 */
export function resolveGeminiApiKey() {
  const first = (value) =>
    value
      .split(',')
      .map((k) => k.trim())
      .find((k) => k.length > 0) ?? null;

  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv?.trim()) return first(fromEnv);

  if (!existsSync(REPO_ENV)) return null;
  const line = readFileSync(REPO_ENV, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) return null;
  const value = line
    .slice('GEMINI_API_KEY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  return value ? first(value) : null;
}
