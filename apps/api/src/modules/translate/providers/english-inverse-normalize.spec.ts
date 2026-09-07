import { describe, expect, it } from 'vitest';
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

  /**
   * The two evidence rules English declared and did not enforce.
   *
   * `ENGLISH_TIERS` has always said `one` and `oh` may not carry a span alone,
   * but the quantity rule asked the weak question — so `and` vouched for `one`
   * and `one hundred and one` came back as `100 and 1`, a fragment of a number.
   * And the year pair had no anchor at all, so `open twenty four seven` read as
   * `2047`: a number nobody said, out of an idiom that is not a year.
   */
  describe('evidence an ambiguous numeral and a bare year each require', () => {
    it.each([
      [
        'no one came to the meeting',
        '`no` is the negation far more often than "No."',
      ],
      [
        'that is our one and only option',
        '`and` joins anything and vouches for nothing',
      ],
      ['one and one', ''],
      ['plan a and one more', ''],
      ['chapter one', '`chapter` is not a measure word'],
    ])('writes no digit in %j', (text) => {
      expect(digitsIn(itn(text))).toEqual([]);
    });

    it('still reads `one` where a real marker or measure word vouches for it', () => {
      expect(itn('number one')).toBe('number 1');
      expect(itn('one person')).toBe('1 person');
      expect(itn('one second please')).toBe('1 second please');
    });

    it('refuses a bare year with nothing introducing it', () => {
      expect(digitsIn(itn('the shop is open twenty four seven'))).toEqual([]);
      expect(digitsIn(itn('twenty four seven'))).toEqual([]);
    });

    it('reads the year once a word introduces one', () => {
      expect(itn('born in nineteen ninety eight')).toBe('born in 1998');
      expect(itn('since nineteen forty five')).toBe('since 1945');
    });

    it('leaves a month-anchored date reachable, which needs no left context', () => {
      expect(itn('on october tenth nineteen thirteen')).toBe(
        'on october 10 1913',
      );
    });
  });
  /**
   * `and` sits INSIDE one English compound and BETWEEN two separate numbers,
   * and reading it the same way in both places produced the fragment this
   * module exists to never produce: `three hundred and sixty degrees` came back
   * as `300 and 60 degrees`, a mangled 360.
   */
  describe('`and` inside a compound, and nowhere else', () => {
    it.each([
      ['one hundred and one', '101'],
      ['one hundred and twenty', '120'],
      [
        'a full circle is three hundred and sixty degrees',
        'a full circle is 360 degrees',
      ],
      ['there were one hundred and five people', 'there were 105 people'],
    ])('reads %j as one number', (text, expected) => {
      expect(itn(text)).toBe(expected);
    });

    it('refuses the compound it cannot reach the front of, rather than half of it', () => {
      // `a` is never consumed — it is the article far more often than the
      // number — so `a hundred` has no reading, and typesetting the tail alone
      // would leave `a hundred and 20` on screen.
      expect(itn('a hundred and twenty of them arrived')).toBe(
        'a hundred and twenty of them arrived',
      );
      expect(digitsIn(itn('a hundred and one'))).toEqual([]);
    });

    it('does not join two separate quantities across it', () => {
      // `two and three` is two numbers. Refusing costs the reading of both,
      // which is the trade: a missed numeral is still readable as words.
      expect(digitsIn(itn('two and three'))).toEqual([]);
      expect(digitsIn(itn('two and a half'))).toEqual([]);
      expect(digitsIn(itn('bread and butter'))).toEqual([]);
    });

    it('still refuses a scale word with nothing in front of it', () => {
      expect(digitsIn(itn('a hundred'))).toEqual([]);
      expect(digitsIn(itn('hundred'))).toEqual([]);
    });
  });
});
