import { en, LOCALES, vi, zh, type Locale, type Messages } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';

/**
 * The copy register, applied to the one surface where it dies first.
 *
 * `docs/design-guidelines.md` § Copy register: **name the wait, the outcome, or the next
 * step — never the pipeline.** Its exemplar is a line that used to read "recognise,
 * translate, speak" and became "waits for a sentence to finish before answering",
 * because the first is a fact about the implementation and the second is a fact about
 * the reader.
 *
 * Marketing copy is where that rule is hardest to keep. A landing page wants to explain
 * how clever the thing is, and the vocabulary for clever is exactly the vocabulary the
 * rule bans — component names, engine names, and the measurement instruments used to
 * choose them. None of those are words the product says.
 *
 * This checks the dictionary rather than the rendered page on purpose: the strings are
 * what a copy edit touches, and an edit is how the violation arrives.
 */

/**
 * Bans that hold in every locale: proper nouns, component acronyms, architecture words
 * and language codes read the same in a Vietnamese or Chinese sentence as in an English one.
 */
const SHARED_BANNED: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bSTT\b|\bTTS\b/i,
    why: 'component names, not words the product says',
  },
  {
    pattern: /\bcascade\b|\bpipeline\b|\bbackend\b|\bWebSocket\b|\bsidecar\b/i,
    why: 'architecture the reader cannot see and did not ask about',
  },
  {
    pattern:
      /\bGemini\b|\bWhisper\b|\bZipformer\b|\bKokoro\b|\bPiper\b|\bMoonshine\b|\bElevenLabs\b/i,
    why: 'engine names. Which engine is an implementation choice, and it has changed once already',
  },
  {
    pattern: /\blatency\b|\bp50\b|\bp95\b|\bRTF\b|\bWER\b|\bbenchmark\b/i,
    why: 'measurement instruments. Name the wait in words a reader can act on',
  },
  {
    // The half that is greppable. A runtime guarantee needs more than a grep — the
    // detected language arrives as a code and is named through `nativeLanguageName` —
    // but a hard-coded code in the dictionary is exactly what a grep catches.
    // Boundaries are Unicode letters, not [A-Za-z]: the "vi" inside Vietnamese "việc" is
    // followed by an accented letter and is a word, not a code.
    pattern: /(^|[^\p{L}])(vi|en|vi-VN|en-US)([^\p{L}]|$)/u,
    why: 'a language code reached the screen. Use the language name',
  },
];

const PIPELINE_WHY =
  'names the pipeline. Say what happens to the reader — what is kept, and what the translator sees';

/**
 * Pipeline vocabulary is language-specific, so each locale lists its own. Typed as a
 * `Record<Locale, …>` so a locale added to `LOCALES` without a ban list fails `tsc`.
 */
const LOCALE_BANNED: Record<Locale, ReadonlyArray<{ pattern: RegExp; why: string }>> = {
  en: [
    {
      pattern: /recognis|recogniz|synthesis|synthesi[sz]e|speech.to.text|text.to.speech/i,
      why: PIPELINE_WHY,
    },
  ],
  vi: [
    {
      pattern:
        /nhận dạng|nhận diện giọng|giọng nói thành văn bản|văn bản thành giọng nói|tổng hợp giọng|chuyển giọng|đường ống|phiên âm/i,
      why: PIPELINE_WHY,
    },
  ],
  zh: [
    {
      pattern: /语音识别|识别|转写|转录|语音合成|合成|流水线|管道|文本转语音|语音转文本|文字转语音/,
      why: PIPELINE_WHY,
    },
  ],
};

const DICTIONARIES: Record<Locale, Messages> = { en, vi, zh };

const landingOf = (locale: Locale) =>
  Object.entries(DICTIONARIES[locale]).filter(([key]) => key.startsWith('web.landing.'));

describe.each(LOCALES)('the %s landing copy', (locale) => {
  const landing = landingOf(locale);

  it('has strings to check', () => {
    // A floor, so a renamed namespace fails loudly instead of checking an empty list.
    expect(landing.length).toBeGreaterThan(20);
  });

  it.each([...SHARED_BANNED, ...LOCALE_BANNED[locale]])(
    'says nothing matching $pattern — $why',
    ({ pattern }) => {
      const offenders = landing
        .filter(([, value]) => pattern.test(value))
        .map(([key, value]) => `${key}: ${value}`);
      expect(offenders).toEqual([]);
    },
  );
});
