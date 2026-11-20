import { describe, expect, it } from 'vitest';

import { addsUnsupportedName } from './polish-unsupported-names.js';

/**
 * The cases are recorded prod turns and the recorded `gpt-5.6-sol` answers to
 * them, so each row is something the polisher really wrote.
 */
const hobbies = {
  sourceLanguage: 'en' as const,
  targetLanguage: 'vi' as const,
  source: 'Have your hobbies changed since hoping?',
  draft: 'Sở thích của bạn có thay đổi kể từ khi hy vọng không?',
  context: [
    "I don't get out as much as I'd like to, but it's one of my favorite things to do. Okay.",
  ],
};

describe('addsUnsupportedName', () => {
  it.each([
    'Sở thích của bạn có thay đổi kể từ khi có COVID không?',
    'Sở thích của bạn có thay đổi kể từ khi có COVID-19 không?',
    'Sở thích của bạn có thay đổi kể từ khi xảy ra đại dịch COVID-19 không?',
  ])('rejects an en→vi edit that invents an event the speaker never named: %s', (edited) => {
    expect(addsUnsupportedName({ ...hobbies, edited })).toBe(true);
  });

  it('lets an en→vi repair through when it adds no name', () => {
    // "depends on the league" was heard for "depends on the week": a real repair.
    expect(
      addsUnsupportedName({
        sourceLanguage: 'en',
        targetLanguage: 'vi',
        source:
          'Eating at restaurants, I think it depends on the league, you know? Having a bad week.',
        draft: 'Ăn ở nhà hàng thì tôi nghĩ còn tùy vào giải đấu, bạn biết đấy. Một tuần tồi tệ.',
        edited: 'Ăn ở nhà hàng thì tôi nghĩ còn tùy vào từng tuần, bạn biết đấy. Một tuần tồi tệ.',
      }),
    ).toBe(false);
  });

  it('accepts a name or number the transcript, the draft or the context already holds', () => {
    const base = { sourceLanguage: 'en' as const, targetLanguage: 'vi' as const };
    // In the transcript, cased differently.
    expect(
      addsUnsupportedName({
        ...base,
        source: 'i talk on instagram and snapchat',
        draft: 'tôi nói chuyện trên instagram và snapchat',
        edited: 'Tôi nói chuyện qua Instagram và Snapchat.',
      }),
    ).toBe(false);
    // Only in the earlier speech.
    expect(
      addsUnsupportedName({
        ...base,
        source: 'he works there now',
        draft: 'giờ anh ấy làm ở đó',
        context: ['My brother moved to Anthropic last year.'],
        edited: 'Giờ anh ấy làm ở Anthropic.',
      }),
    ).toBe(false);
    // A spoken number joined into one written token.
    expect(
      addsUnsupportedName({
        ...base,
        source: 'since covid 19',
        draft: 'kể từ covid 19',
        edited: 'Kể từ COVID-19.',
      }),
    ).toBe(false);
  });

  it('never checks vi→en, where restoring a misheard name is the point', () => {
    expect(
      addsUnsupportedName({
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        source: 'mô đờ a đờ réc và giáo sư giô sua ben giô',
        draft: 'The mode of adrec and Professor Joshua Bengio',
        edited: 'Dario Amodei of Anthropic and Professor Yoshua Bengio',
      }),
    ).toBe(false);
  });

  it('reads decomposed Vietnamese the same as composed', () => {
    const composed = {
      sourceLanguage: 'en' as const,
      targetLanguage: 'vi' as const,
      source: 'i live in viet nam',
      draft: 'tôi sống ở Việt Nam',
    };
    const edited = 'Tôi sống ở Việt Nam.';
    expect(addsUnsupportedName({ ...composed, edited: edited.normalize('NFD') })).toBe(false);
    expect(addsUnsupportedName({ ...composed, edited })).toBe(false);
  });

  it('treats a word opening a quotation or a new line as a sentence start', () => {
    const base = {
      sourceLanguage: 'en' as const,
      targetLanguage: 'vi' as const,
      source: 'he said i do not know and left',
      draft: 'anh ấy nói tôi không biết rồi bỏ đi',
    };
    expect(
      addsUnsupportedName({ ...base, edited: 'Anh ấy nói: "Tôi không biết." Rồi bỏ đi.' }),
    ).toBe(false);
    expect(addsUnsupportedName({ ...base, edited: 'Anh ấy nói vậy\nRồi bỏ đi.' })).toBe(false);
  });

  it('leaves a capital opening a sentence alone, which is a stated gap', () => {
    // Ordinary casing cannot be told from a name here; a digit still counts.
    const base = { ...hobbies, draft: 'hy vọng.' };
    expect(addsUnsupportedName({ ...base, edited: 'Covid. Hy vọng.' })).toBe(false);
    expect(addsUnsupportedName({ ...base, edited: 'Covid19. Hy vọng.' })).toBe(true);
  });
});
