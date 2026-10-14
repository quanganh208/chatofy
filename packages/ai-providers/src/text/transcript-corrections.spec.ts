import { describe, expect, it } from 'vitest';
import {
  applyTranscriptCorrections,
  countWords,
  mergeCorrections,
} from './transcript-corrections.js';

describe('applyTranscriptCorrections', () => {
  it('replaces the words where they stand, keeping punctuation and case', () => {
    expect(
      applyTranscriptCorrections('Giao động mạnh, đâm giao nghiêm trọng.', [
        { heard: 'giao động', said: 'dao động', at: 0 },
        { heard: 'đâm giao', said: 'đâm dao', at: 3 },
      ]),
    ).toBe('Dao động mạnh, đâm dao nghiêm trọng.');
  });

  it('keeps a word written in capitals in capitals', () => {
    expect(
      applyTranscriptCorrections('TRỢ LÁCH', [{ heard: 'trợ lách', said: 'chợ lách', at: 0 }]),
    ).toBe('CHỢ LÁCH');
  });

  it('repairs only the place named, not the same word elsewhere', () => {
    expect(
      applyTranscriptCorrections('Đâm giao rồi giao hàng.', [
        { heard: 'giao', said: 'dao', at: 1 },
      ]),
    ).toBe('Đâm dao rồi giao hàng.');
  });

  it('skips a repair whose words are not at its place', () => {
    const line = 'giao cho cảnh sát.';
    expect(applyTranscriptCorrections(line, [{ heard: 'đâm giao', said: 'đâm dao', at: 0 }])).toBe(
      line,
    );
    expect(applyTranscriptCorrections(line, [])).toBe(line);
  });
});

describe('applyTranscriptCorrections across word counts', () => {
  it('replaces a stretch with fewer words, taking the case of its first', () => {
    expect(
      applyTranscriptCorrections('Kẻ sọ đã vỡ.', [{ heard: 'kẻ sọ', said: 'kè', at: 0 }]),
    ).toBe('Kè đã vỡ.');
  });

  it('replaces a word with more words where it stands', () => {
    expect(
      applyTranscriptCorrections('Ông ấy bị vị trí, phải mổ.', [
        { heard: 'vị trí', said: 'bệnh trĩ', at: 3 },
        { heard: 'mổ', said: 'đi mổ', at: 6 },
      ]),
    ).toBe('Ông ấy bị bệnh trĩ, phải đi mổ.');
  });

  it('drops a mark inside a stretch of another length, keeps one between equal words', () => {
    expect(
      applyTranscriptCorrections('Kẻ, sọ đã vỡ.', [{ heard: 'kẻ sọ', said: 'kè', at: 0 }]),
    ).toBe('Kè đã vỡ.');
    expect(
      applyTranscriptCorrections('Ra, cùng nhau.', [{ heard: 'ra cùng', said: 'gia cố', at: 0 }]),
    ).toBe('Gia, cố nhau.');
  });

  it('skips a correction overlapping one before it', () => {
    expect(
      applyTranscriptCorrections('đâm giao rồi', [
        { heard: 'đâm giao', said: 'đâm dao', at: 0 },
        { heard: 'giao rồi', said: 'dao rồi', at: 1 },
      ]),
    ).toBe('đâm dao rồi');
  });
});

describe('mergeCorrections', () => {
  it('keeps the first list and what of the second touches none of its words', () => {
    const first = [{ heard: 'giao', said: 'dao', at: 1 }];
    const second = [
      { heard: 'đâm giao', said: 'đâm dao', at: 0 },
      { heard: 'hàng', said: 'hãng', at: 3 },
    ];
    expect(mergeCorrections(first, second)).toEqual([
      { heard: 'giao', said: 'dao', at: 1 },
      { heard: 'hàng', said: 'hãng', at: 3 },
    ]);
  });
});

describe('countWords', () => {
  it('counts words as a repair index counts them', () => {
    expect(countWords('Đâm giao, rồi giao hàng.')).toBe(5);
    expect(countWords('')).toBe(0);
  });
});
