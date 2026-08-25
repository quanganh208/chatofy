import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * There is one way out of the app, and this is how it stays one.
 *
 * Sign out is reached from three places — the sidebar avatar menu, `/account`, and the
 * recovery path that runs when a token has aged out — and they have to behave
 * identically. The failure mode is not dramatic: someone adds a fourth caller with
 * `signOut()` and no `redirectTo`, and that one path lands on `/` while the others land
 * on `/login`. Nothing breaks, nothing is logged, and the difference is only visible to
 * whoever happens to sign out from the new place.
 *
 * It is also where the sentence about what signing out does NOT do is written. A second
 * call site is a second place someone can describe it, and the wrong description —
 * "sign out everywhere" — is a security claim this system does not implement.
 */

const ROOT = resolve(process.cwd());
const SKIP = new Set(['node_modules', '.next', '.output', 'dist', 'public']);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('signing out', () => {
  it('has exactly one implementation', () => {
    const files = [...walk(`${ROOT}/src`), ...walk(`${ROOT}/app`)];
    // A floor, so a walk that silently resolved to nothing fails loudly instead of
    // passing vacuously.
    expect(files.length).toBeGreaterThan(40);

    const callers = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      // The import, not the word: this spec names `signOut` in its own prose, and so
      // does the docblock of the module it guards.
      return /import\s*\{[^}]*\bsignOut\b[^}]*\}\s*from\s*'next-auth\/react'/.test(source);
    });

    expect(callers.map((file) => file.slice(ROOT.length + 1))).toEqual(['src/lib/sign-out.ts']);
  });
});
