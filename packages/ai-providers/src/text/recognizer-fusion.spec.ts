import { describe, expect, it } from 'vitest';
import { acceptRecognizerFusion } from './recognizer-fusion.js';

describe('acceptRecognizerFusion', () => {
  const transcript = 'Hắn đâm giao vào người nạn nhân';
  const alternate = 'hắn đâm dao vào người nạn nhân';

  it('takes a stretch the other recognizer heard', () => {
    expect(acceptRecognizerFusion(transcript, [alternate], alternate)).toEqual([
      { heard: 'giao', said: 'dao', at: 2 },
    ]);
  });

  it('takes a replacement of a different length when it is the alternate’s run', () => {
    expect(acceptRecognizerFusion('kẻ sọ đã vỡ', ['kè đã vỡ'], 'kè đã vỡ')).toEqual([
      { heard: 'kẻ sọ', said: 'kè', at: 0 },
    ]);
  });

  it('refuses words no recognizer heard in that run', () => {
    // "con dao" is in neither transcript as a run, even though both words are.
    expect(
      acceptRecognizerFusion(
        transcript,
        ['hắn đâm con vào người dao'],
        'hắn đâm con dao vào người nạn nhân',
      ),
    ).toEqual([]);
    expect(
      acceptRecognizerFusion(transcript, [alternate], 'hắn đâm kiếm vào người nạn nhân'),
    ).toEqual([]);
  });

  it('refuses words the other recognizer heard elsewhere in the turn', () => {
    // Both heard "súng" — in the spoken order, not where "bánh" is.
    const order = 'thay chữ bánh bằng chữ súng trong câu tôi mua bánh';
    expect(
      acceptRecognizerFusion(
        order,
        ['thay chữ bánh bằng chữ súng trong câu tôi mua bánh nhé'],
        'thay chữ bánh bằng chữ súng trong câu tôi mua súng',
      ),
    ).toEqual([]);
  });

  it('never replaces a word the other recognizer heard too', () => {
    expect(
      acceptRecognizerFusion('tôi không đồng ý', ['tôi vẫn không đồng ý'], 'tôi vẫn đồng ý'),
    ).toEqual([]);
  });

  it('never drops or adds words', () => {
    expect(acceptRecognizerFusion(transcript, ['hắn đâm vào người'], 'hắn đâm vào người')).toEqual(
      [],
    );
    expect(acceptRecognizerFusion('đâm vào người', ['à đâm vào người'], 'à đâm vào người')).toEqual(
      [],
    );
  });

  it('keeps the words of the turn’s hint terms as heard', () => {
    expect(
      acceptRecognizerFusion('giải poker lớn', ['giải bố cơ lớn'], 'giải bố cơ lớn', ['Poker']),
    ).toEqual([]);
  });

  it('keeps each stretch on its own merits', () => {
    expect(
      acceptRecognizerFusion(
        'ra cùng đê và đạt đinh',
        ['gia cố đê và đạt đinh lũ'],
        'gia cố đê và đạt đỉnh',
      ),
    ).toEqual([{ heard: 'ra cùng', said: 'gia cố', at: 0 }]);
  });

  it('refuses a change of spelling or spacing that sounds the same', () => {
    expect(acceptRecognizerFusion('mở khóa cửa', ['mở khoá cửa'], 'mở khoá cửa')).toEqual([]);
    expect(
      acceptRecognizerFusion(
        'sam altman của openai',
        ['sam altman của open ai'],
        'sam altman của open ai',
      ),
    ).toEqual([]);
  });

  it('is nothing for an answer that is not text, or empty', () => {
    expect(acceptRecognizerFusion(transcript, [alternate], undefined)).toEqual([]);
    expect(acceptRecognizerFusion(transcript, [alternate], { text: alternate })).toEqual([]);
    expect(acceptRecognizerFusion(transcript, [alternate], '')).toEqual([]);
    expect(acceptRecognizerFusion(transcript, [alternate], transcript)).toEqual([]);
  });
});
