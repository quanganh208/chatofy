import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No class name from a token vocabulary that no longer exists.
 *
 * `text-textMuted` and `bg-surfaceRaised` came from an earlier palette. Tailwind
 * generates nothing for a utility whose token is missing, so the class was silently
 * dropped: every "muted" line in the conference screens rendered at full foreground
 * weight and the video tiles had no ground at all. Nothing failed, because nothing
 * reported an unknown class. The current names are `text-muted-foreground` and
 * `bg-muted`.
 */
const ROOTS = ['../../app', '../../src'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const LEGACY =
  /\b(?:text|bg|border|ring|fill|stroke|divide|placeholder)-(?:textMuted|textPrimary|textSecondary|surfaceRaised|surfaceSunken|borderStrong|textInverse)\b/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

describe('legacy token classes', () => {
  it('finds files to scan, so an empty walk cannot pass', () => {
    expect(ROOTS.flatMap(walk).length).toBeGreaterThan(100);
  });

  it('uses none of the retired class names', () => {
    const offenders = ROOTS.flatMap(walk)
      .filter((file) => !file.endsWith('legacy-token-classes.spec.ts'))
      .flatMap((file) => {
        const hits = readFileSync(file, 'utf8').match(LEGACY);
        return hits ? [`${file}: ${[...new Set(hits)].join(', ')}`] : [];
      });
    expect(offenders).toEqual([]);
  });
});
