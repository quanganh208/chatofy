import { en } from '@chatofy/i18n';
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

const BANNED: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /recognis|recogniz|synthesis|synthesi[sz]e/i,
    why: 'names the pipeline. Say what happens to the reader — their voice is handled on their machine',
  },
  {
    pattern: /speech.to.text|text.to.speech|\bSTT\b|\bTTS\b/i,
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
    // The half that is greppable. `live-panel.tsx`'s note explains why a runtime
    // guarantee needs more than a grep — but a hard-coded code in the dictionary is
    // exactly what a grep catches.
    pattern: /(^|[^A-Za-z])(vi|en|vi-VN|en-US)([^A-Za-z]|$)/,
    why: 'a language code reached the screen. Use the language name',
  },
];

const LANDING = Object.entries(en).filter(([key]) => key.startsWith('web.landing.'));

describe('the landing copy', () => {
  it('has strings to check', () => {
    // A floor, so a renamed namespace fails loudly instead of checking an empty list.
    expect(LANDING.length).toBeGreaterThan(20);
  });

  it.each(BANNED)('says nothing matching $pattern — $why', ({ pattern }) => {
    const offenders = LANDING.filter(([, value]) => pattern.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );
    expect(offenders).toEqual([]);
  });
});
