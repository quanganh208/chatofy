import { describe, expect, it } from 'vitest';
import {
  fillConversationLanguages,
  fillLegacyConversationFields,
  fillTurnLanguages,
  legacyDirectionOf,
} from './language-fields-compat.js';

describe('fillConversationLanguages', () => {
  it('derives languages from a legacy vi_to_en direction, declared source first', () => {
    expect(fillConversationLanguages({ direction: 'vi_to_en' })).toEqual({
      direction: 'vi_to_en',
      languages: ['vi', 'en'],
    });
  });

  it('derives languages from a legacy en_to_vi direction', () => {
    expect(fillConversationLanguages({ direction: 'en_to_vi' })).toEqual({
      direction: 'en_to_vi',
      languages: ['en', 'vi'],
    });
  });

  it('leaves an object that already carries languages untouched', () => {
    const raw = { direction: 'vi_to_en', languages: ['vi', 'en', 'ja'] };
    expect(fillConversationLanguages(raw)).toBe(raw);
  });

  it('leaves an object with neither field alone, for the schema to reject', () => {
    const raw = { startedAt: '2026-01-01T00:00:00.000Z' };
    expect(fillConversationLanguages(raw)).toBe(raw);
  });
});

describe('fillTurnLanguages', () => {
  const languages = ['vi', 'en'] as const;

  it('fills the vi speaker_a turn of a vi_to_en conversation', () => {
    expect(fillTurnLanguages({ speakerRole: 'speaker_a', targetText: 'hello' }, languages)).toEqual(
      {
        speakerRole: 'speaker_a',
        targetText: 'hello',
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
      },
    );
  });

  it('fills the en speaker_b turn of a vi_to_en conversation', () => {
    expect(
      fillTurnLanguages({ speakerRole: 'speaker_b', targetText: 'chào bạn' }, languages),
    ).toEqual({
      speakerRole: 'speaker_b',
      targetText: 'chào bạn',
      sourceLanguages: ['en'],
      translations: { vi: 'chào bạn' },
    });
  });

  it('keeps speaker_a as the Vietnamese side of an en_to_vi conversation too', () => {
    // The invariant `PrismaConversationStore.save`'s docblock names: speaker_a
    // is the Vietnamese side regardless of which language the conversation
    // declared first.
    const enToVi = ['en', 'vi'] as const;
    expect(
      fillTurnLanguages({ speakerRole: 'speaker_a', targetText: 'ready to ship?' }, enToVi),
    ).toMatchObject({ sourceLanguages: ['vi'], translations: { en: 'ready to ship?' } });
  });

  it('leaves a turn that already carries translations untouched', () => {
    const raw = { speakerRole: 'speaker_a', translations: { en: 'hi' } };
    expect(fillTurnLanguages(raw, languages)).toBe(raw);
  });

  it('leaves a turn whose speakerRole matches no conversation language alone', () => {
    const raw = { speakerRole: 'not-a-role', targetText: 'x' };
    expect(fillTurnLanguages(raw, languages)).toBe(raw);
  });
});

describe('fillLegacyConversationFields', () => {
  it('fills languages and every turn from a fully legacy conversation body', () => {
    const raw = {
      direction: 'vi_to_en',
      turns: [
        { speakerRole: 'speaker_a', targetText: 'hello' },
        { speakerRole: 'speaker_b', targetText: 'chào bạn' },
      ],
    };
    expect(fillLegacyConversationFields(raw)).toEqual({
      direction: 'vi_to_en',
      languages: ['vi', 'en'],
      turns: [
        {
          speakerRole: 'speaker_a',
          targetText: 'hello',
          sourceLanguages: ['vi'],
          translations: { en: 'hello' },
        },
        {
          speakerRole: 'speaker_b',
          targetText: 'chào bạn',
          sourceLanguages: ['en'],
          translations: { vi: 'chào bạn' },
        },
      ],
    });
  });

  it('leaves a body already carrying languages and per-turn translations untouched', () => {
    const raw = {
      direction: 'vi_to_en',
      languages: ['vi', 'en'],
      turns: [{ speakerRole: 'speaker_a', translations: { en: 'hello' } }],
    };
    expect(fillLegacyConversationFields(raw)).toEqual(raw);
  });

  it('passes through a non-object body for the schema to reject', () => {
    expect(fillLegacyConversationFields(null)).toBeNull();
    expect(fillLegacyConversationFields('nope')).toBe('nope');
  });

  it('leaves turns untouched when languages could not be derived at all', () => {
    const raw = { turns: [{ speakerRole: 'speaker_a', targetText: 'hello' }] };
    expect(fillLegacyConversationFields(raw)).toBe(raw);
  });
});

describe('legacyDirectionOf', () => {
  it('reconstructs vi_to_en from a declared-source-first pair', () => {
    expect(legacyDirectionOf(['vi', 'en'])).toBe('vi_to_en');
  });

  it('reconstructs en_to_vi when english was declared first', () => {
    expect(legacyDirectionOf(['en', 'vi'])).toBe('en_to_vi');
  });

  it('throws on a corrupt row carrying fewer than two languages', () => {
    expect(() => legacyDirectionOf(['vi'])).toThrow(/at least two languages/);
    expect(() => legacyDirectionOf([])).toThrow(/at least two languages/);
  });
});
