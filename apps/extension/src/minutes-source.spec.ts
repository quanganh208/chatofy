import { describe, expect, it } from 'vitest';
import type { TranscriptLine } from './messages';
import { overlayLinesToMinutesSource } from './minutes-source';

const line = (
  sourceText: string,
  origin: TranscriptLine['origin'],
  final = true,
): TranscriptLine => ({
  sessionId: `s-${sourceText}`,
  sourceText,
  targetText: 'translated',
  final,
  origin,
});

const labels = { them: 'Meeting', me: 'You' };

describe('overlayLinesToMinutesSource', () => {
  it('labels each line by its side and keeps the source text, in order', () => {
    const result = overlayLinesToMinutesSource(
      [line('xin chào', 'them'), line('hello back', 'me')],
      labels,
    );
    expect(result).toEqual([
      { speakerLabel: 'Meeting', text: 'xin chào' },
      { speakerLabel: 'You', text: 'hello back' },
    ]);
  });

  it('drops lines that are not final yet', () => {
    const result = overlayLinesToMinutesSource(
      [line('settled', 'them', true), line('still growing', 'me', false)],
      labels,
    );
    expect(result).toEqual([{ speakerLabel: 'Meeting', text: 'settled' }]);
  });

  it('drops empty or whitespace-only source lines', () => {
    const result = overlayLinesToMinutesSource([line('   ', 'them'), line('real', 'me')], labels);
    expect(result).toEqual([{ speakerLabel: 'You', text: 'real' }]);
  });

  it('is empty for no lines', () => {
    expect(overlayLinesToMinutesSource([], labels)).toEqual([]);
  });
});
