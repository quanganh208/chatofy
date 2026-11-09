import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 11px uppercase is for SECTION headings only.
 *
 * `docs/design-guidelines.md` ("A control's label is text-body medium, sentence case")
 * says Vietnamese capitals with their diacritics at 11px were the hardest text on the
 * settings screens. hallmark's sloplint (gate 67) found three places that had drifted
 * from it: the speaker line on a stored transcript (a person's name, so
 * "NGUYỄN THỊ PHƯƠNG ANH"), the Source / Translation column label (the guideline names
 * it as a `text-hint` sub-label), and the conference "Meeting code" label.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('uppercase labels stay on section headings', () => {
  it.each([
    ['the history transcript speaker line', '../components/history/history-transcript.tsx'],
    ['the translate column labels', '../components/translate/panel-headers.tsx'],
    ['the conference room header', '../../app/(app)/conference/[roomId]/page.tsx'],
  ])('%s is sentence case', (_name, file) => {
    expect(read(file)).not.toMatch(/\buppercase\b/);
  });
});
