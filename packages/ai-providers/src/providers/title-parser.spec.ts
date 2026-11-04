import { describe, expect, it } from 'vitest';
import { ProviderResponseError } from '../errors/provider-errors.js';
import { parseTitle } from './title-parser.js';
import { TITLE_MAX_CHARS } from './title-prompt-builder.js';

describe('parseTitle', () => {
  it('reads the title out of the JSON object', () => {
    expect(parseTitle('{"title":"Thuê căn hộ ở Quận 3"}', 'm')).toBe('Thuê căn hộ ở Quận 3');
  });

  it('reads a fenced answer', () => {
    expect(parseTitle('```json\n{"title":"Job interview"}\n```', 'm')).toBe('Job interview');
  });

  it('collapses a multi-line title to one line', () => {
    expect(parseTitle('{"title":"Doctor\\n  visit"}', 'm')).toBe('Doctor visit');
  });

  it('strips wrapping quotes and a trailing period', () => {
    expect(parseTitle('{"title":"“Planning the launch.”"}', 'm')).toBe('Planning the launch');
  });

  it('cuts a long title at a word boundary within the cap', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const title = parseTitle(JSON.stringify({ title: long }), 'm');
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    expect(long.startsWith(title)).toBe(true);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('refuses an empty title', () => {
    expect(() => parseTitle('{"title":"  \\"\\" "}', 'm')).toThrow(ProviderResponseError);
  });

  it('refuses an answer that is not JSON', () => {
    expect(() => parseTitle('A nice title', 'm')).toThrow(ProviderResponseError);
  });

  it('refuses an object without a title string', () => {
    expect(() => parseTitle('{"summary":"x"}', 'm')).toThrow(ProviderResponseError);
  });
});
