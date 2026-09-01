import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONVERSATION_AUDIO } from './open-microphone';

/**
 * The channel recorder captures what production captures.
 *
 * `benchmarks/speaker-id/recorder/index.html` is a plain HTML page served as-is
 * by a 74-line static file server with no bundler, so it cannot import this
 * module — its constraint block is a hand-copied replica. That copy is the whole
 * validity of the fixture: a recorder that opens a microphone with different
 * processing measures a channel the product does not use, and reports a number
 * for it anyway.
 *
 * The drift is not hypothetical. The recorder's own comment cited
 * `use-streaming-translate.ts` as its source, and the literal has never lived
 * there — it has always been {@link CONVERSATION_AUDIO} in this file. Nothing
 * caught that for as long as it was wrong, because a stale copy and a fresh one
 * look identical from either side.
 *
 * This is the cheapest available fix. The recording session is one-shot: if the
 * gate kills the feature nobody is recorded a second time, so a mismatch found
 * afterwards cannot be corrected by recording again.
 */

const RECORDER_HTML = fileURLToPath(
  new URL('../../../../benchmarks/speaker-id/recorder/index.html', import.meta.url),
);

/**
 * One `const NAME = { ... };` object literal out of the recorder's script.
 *
 * Deliberately not `eval`: the page is 500 lines of DOM code and evaluating it
 * to read four booleans would drag a browser environment into a node test. The
 * literal is boolean-only by construction, so a key/value scan is sufficient
 * and fails loudly if it ever stops being.
 */
function readConstraintLiteral(html: string, name: string): Record<string, boolean> {
  const block = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(html);
  if (!block) throw new Error(`${name} not found in the recorder page`);
  const parsed: Record<string, boolean> = {};
  for (const [, key, value] of block[1]!.matchAll(/(\w+)\s*:\s*(true|false)\s*,?/g)) {
    parsed[key!] = value === 'true';
  }
  const declared = block[1]!.split(',').filter((line) => line.trim()).length;
  if (Object.keys(parsed).length !== declared) {
    throw new Error(
      `${name} holds something other than boolean fields; this spec can no longer read it`,
    );
  }
  return parsed;
}

describe('the channel recorder mirrors the production constraints', () => {
  const html = readFileSync(RECORDER_HTML, 'utf8');

  it('asks for exactly what CONVERSATION_AUDIO asks for', () => {
    expect(readConstraintLiteral(html, 'PRODUCTION_CONSTRAINTS')).toEqual(CONVERSATION_AUDIO);
  });

  it('turns every one of those fields off in the control', () => {
    // Not merely "all false": the control has to negate the SAME field set. A
    // control missing a field is a track where that processing stayed at the
    // browser default, so the delta for it would be measured against itself and
    // read as zero.
    const production = readConstraintLiteral(html, 'PRODUCTION_CONSTRAINTS');
    const control = readConstraintLiteral(html, 'CONTROL_CONSTRAINTS');
    expect(Object.keys(control).sort()).toEqual(Object.keys(production).sort());
    expect(Object.values(control).every((value) => value === false)).toBe(true);
  });

  it('names this module as the source it was copied from', () => {
    // The comment is load-bearing: it is what sends the next person editing
    // CONVERSATION_AUDIO to the recorder. It pointed at the wrong file once.
    expect(html).toContain('open-microphone.ts');
  });
});
