import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitIntoClauses } from './clause-splitter';

// Read rather than imported: the api's tsconfig is a composite project that
// would have to list the JSON file, and nothing at runtime needs it.
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'clause-splitter.cases.json'), 'utf-8'),
) as { cases: { name: string; input: string; parts: string[] }[] };

describe('splitIntoClauses', () => {
  // Input/output pairs live in a fixture the TTS sidecar's Python port reads
  // too, so the two splitters cannot drift apart unnoticed. Among them are the
  // exact sentences the latency spike measured — a regression there is a
  // regression in the number the clause path was built to hit — and the number
  // cases: splitting "1,5 triệu" at its comma would read the number wrong.
  it.each(fixture.cases)('$name', ({ input, parts }) => {
    expect(splitIntoClauses(input)).toEqual(parts);
  });

  it('keeps punctuation with the part it follows', () => {
    // The engine takes its intonation from the mark; stripping it flattens the
    // clause into a statement.
    for (const part of splitIntoClauses('Wait, really?')) {
      expect(part).toMatch(/[,?]$/);
    }
  });

  // "Hello," is 6 characters — the split that produced the largest measured
  // win. A fragment floor that swallowed it would erase the whole benefit.
  it('keeps a short leading clause that pays for itself', () => {
    expect(splitIntoClauses('Hello, how are you?')).toHaveLength(2);
  });

  it('is stable across calls', () => {
    // The boundary regex is module-level and global; a leaked lastIndex would
    // make the second call skip the first boundary.
    const once = splitIntoClauses('Hello, how are you?');
    expect(splitIntoClauses('Hello, how are you?')).toEqual(once);
  });
});
