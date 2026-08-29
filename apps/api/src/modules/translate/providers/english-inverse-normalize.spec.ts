import { inverseNormalizeTranscript } from '@chatofy/ai-providers';

/**
 * The English ITN, which exists because the display path is bidirectional: on
 * `en_to_vi` the transcript being typeset is the English one. Deleting the LLM
 * repair without building this would have stopped display on half the product
 * while the schema went on documenting it.
 *
 * **It recognizes deliberately fewer shapes than the Vietnamese side.** There is
 * no English display-fidelity reference corpus, and the 50 held-out utterances
 * that do exist contain zero digits — so English can be measured for
 * hallucination but has no in-sample spoken recall figure at all. A smaller
 * claim is the right response to weaker evidence, so English abstains sooner.
 */
describe('inverseNormalizeTranscript (en)', () => {
  const itn = (text: string) => inverseNormalizeTranscript(text, 'en');
  const digitsIn = (text: string) => text.match(/\d+(?:[.,:/]\d+)*/g) ?? [];

  describe('never invents a numeral from a word that is not one', () => {
    /**
     * English has no negation that doubles as a digit, so nothing here reverses
     * a meaning — but the same shape misfires on words far commoner as ordinary
     * words than as numbers. All three were measured at 0.0000.
     */
    it.each([
      ['i want a second opinion', '`a` = an article, `second` = an adjective'],
      ['in may a storm hit', '`may` = a modal'],
      ['we march a mile', '`march` = a verb'],
      ['give me a minute', '`a` = an article'],
      ['on second thought', ''],
    ])('writes no digit in %j', (text) => {
      expect(digitsIn(itn(text))).toEqual([]);
    });

    it('never consumes the four ambiguous words at all', () => {
      // English has an unambiguous word for each of those values (`one`, `two`,
      // `three`, `five`), so refusing the ambiguous form costs almost no recall
      // and removes the whole class of failure.
      expect(itn('a second opinion in may before we march')).toBe(
        'a second opinion in may before we march',
      );
    });

    it('refuses a lone number word with nothing beside it', () => {
      expect(digitsIn(itn('he said one to the crowd'))).toEqual([]);
    });

    it('does not anchor a date on `march` or `may`', () => {
      // Both are far commoner as a verb and a modal, which is why they are the
      // two months excluded from the date anchors.
      expect(digitsIn(itn('they march third in line'))).toEqual([]);
      expect(digitsIn(itn('may fifth of that year'))).toEqual([]);
    });

    it('does not read a bare two-part number as a time', () => {
      // `six thirty` is as likely to be two quantities; only a meridiem or
      // `o'clock` says it is a clock.
      expect(itn('six thirty')).not.toContain(':');
    });
  });

  describe('typesets what it does recognize', () => {
    it('reads clocks', () => {
      expect(itn("at six o'clock")).toBe('at 6:00');
      expect(itn('half past two')).toBe('2:30');
      expect(itn('quarter past three')).toBe('3:15');
      expect(itn('quarter to nine')).toBe('8:45');
      expect(itn('six thirty pm')).toBe('6:30 pm');
    });

    it('reads decimals with a DOT, not the Vietnamese comma', () => {
      expect(itn('zero point four metres')).toBe('0.4 metres');
    });

    it('groups thousands with a COMMA, not the Vietnamese dot', () => {
      expect(itn('two thousand five hundred dollars')).toBe('2,500 dollars');
      expect(itn('one hundred twenty thousand dollars')).toBe(
        '120,000 dollars',
      );
    });

    it('reads a compound cardinal', () => {
      expect(itn('twenty five people')).toBe('25 people');
      expect(itn('three seconds')).toBe('3 seconds');
    });

    it('writes an English date rather than a slashed one', () => {
      // `october 10/10/1913` would say the month twice; `October 10, 1913` is
      // how the language writes it, and it keeps every spoken word.
      expect(itn('october tenth nineteen thirteen')).toBe('october 10 1913');
    });

    it('reads a year spoken as two two-digit groups', () => {
      expect(itn('october tenth nineteen thirteen')).toContain('1913');
    });

    it('reads a bare year, which English announces with no marker word', () => {
      // Vietnamese has `năm` in front; English has nothing, and `nineteen
      // ninety eight` has no single-cardinal reading at all.
      expect(itn('born in nineteen ninety eight')).toBe('born in 1998');
    });

    it('does not group a year', () => {
      expect(itn('born in nineteen ninety eight')).not.toContain('1,998');
    });
  });

  describe('the properties the display depends on', () => {
    it('A3 — is byte-identical over 100 runs', () => {
      const text = "we met at six o'clock on october tenth nineteen thirteen";
      const first = itn(text);
      for (let run = 0; run < 100; run += 1) expect(itn(text)).toBe(first);
    });

    it('returns a transcript with no numbers in it byte-identical', () => {
      const text = 'i was born in the city but grew up by the sea';
      expect(itn(text)).toBe(text);
    });

    it('is total on the inputs a live transcript actually produces', () => {
      for (const text of ['', '   ', '...', 'a', '6:00 already']) {
        expect(() => itn(text)).not.toThrow();
      }
    });
  });
});
