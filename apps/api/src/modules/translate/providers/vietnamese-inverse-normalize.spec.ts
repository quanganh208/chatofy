import { inverseNormalizeTranscript } from '@chatofy/ai-providers';

/**
 * The deterministic Vietnamese ITN: spoken number words to digits, before the
 * line is ever painted.
 *
 * **These specs live here rather than beside the module on purpose.**
 * `packages/ai-providers` has no test runner — its scripts are `build`,
 * `typecheck` and `clean`, its devDependencies carry neither vitest nor jest,
 * and it contains no spec files. A spec written there is never collected, so it
 * would report green having executed nothing. This module is a project's abort
 * gate, and a vacuous pass is the worst failure available to it. The repo's own
 * pattern is exactly this file's location: `repair-divergence.spec.ts` sits here
 * and imports through `@chatofy/ai-providers` under jest.
 *
 * Two duties pull against each other throughout, and where they conflict the
 * second wins: produce the digits a reader came for, and never invent one. A
 * missed numeral is a number a reader can still read as words; an invented one
 * is a sentence they cannot question, because nothing on screen marks it as
 * changed.
 */
describe('inverseNormalizeTranscript (vi)', () => {
  const itn = (text: string) => inverseNormalizeTranscript(text, 'vi');
  const digitsIn = (text: string) => text.match(/\d+(?:[.,:/]\d+)*/g) ?? [];

  describe('never invents a numeral from a word that is not one', () => {
    /**
     * `không` is the word for zero AND the ordinary negation, so digitizing it
     * does not alter a sentence — it REVERSES one, on screen, in the speaker's
     * own words. All three of these were measured as real failures of the
     * previous design and each defeated the attempt before it.
     */
    it.each([
      [
        'tôi không đồng ý',
        'the span is `không` alone, vouched for by `đồng` beside it',
      ],
      [
        'hai mươi không đủ',
        '`không` swept into a span another word had justified',
      ],
      ['nó không trăm phần trăm đúng', 'the thing negated is itself a number'],
      ['tôi không phải người hà nội', ''],
      ['không phải ai cũng biết', ''],
    ])('leaves the negation in %j', (text) => {
      expect(itn(text)).not.toMatch(/\b0\b/);
    });

    it('digitizes the real number beside a negation without deleting the negation', () => {
      // The failure mode this replaced printed `20 0 đủ`. Emitting `20` and
      // silently dropping `không` would be worse still, since nothing marks it.
      expect(itn('hai mươi không đủ')).toBe('20 không đủ');
    });

    /**
     * Held-out traps, from utterances the implementation was never built
     * against. Each is a counting word doing an ordinary job.
     */
    it.each([
      [
        'sẽ không khiến bạn trông gầy như những trang phục một màu',
        '`một` = "a", not 1',
      ],
      ['không nản nghĩa tin rằng sẽ có một giải pháp nào đó', '`một` = "a"'],
      [
        'nhưng nếu chỉ nói cái giỏi không thôi thì thật chưa đủ về chú tư',
        '`tư` is a name',
      ],
      [
        'chị hai chủ quán nghe bàn tán rôm rả',
        '`chị Hai` is a form of address',
      ],
      ['rồi chạy sang gõ cửa phòng ba le hai dấm dúi', '`Ba Le` is a name'],
      ['khiến hai cha con cậu', 'an idiom, not a count'],
      [
        'đầu tư tiêu dùng và xuất khẩu đều sẽ tăng mạnh',
        '`tư` inside `đầu tư`',
      ],
      [
        'từng là chủ tế hàng trăm lễ an táng mộ gió',
        'a bare scale word is not a number',
      ],
      [
        'còn anh trai tôi cũng linh cảm điều đó',
        '`linh` is a zero-filler, not a number',
      ],
      ['anh ba năm nay không đi', 'a name, a year, and a negation'],
      [
        'đây là tháng có số đăng ký thấp nhất từ đầu năm đến nay',
        'markers with nothing to mark',
      ],
      ['tôi là con một trong nhà', '`con một` = an only child'],
      ['chuyện đó không đáng', ''],
      ['bác ba đã về quê', '`bác Ba` is a form of address'],
      ['cô tư bán hàng ngoài chợ', '`cô Tư` is a form of address'],
      ['một mình tôi đi thôi', '`một mình` = alone'],
      ['năm ngoái trời rất lạnh', '`năm` = year'],
      ['ba mẹ tôi đều khoẻ', '`ba mẹ` = parents'],
      ['tư duy của anh ấy rất tốt', '`tư duy` = thinking'],
      ['không ai biết chuyện này', ''],
      ['tôi muốn một chút thời gian', '`một chút` = a little'],
      ['ngày nào cũng vậy', 'a marker with no number'],
      ['số phận đã an bài', '`số phận` = fate'],
      ['giờ thì tôi hiểu rồi', '`giờ` = now, no hour before it'],
      ['anh ấy đứng thứ tư', 'an ordinal, not a count'],
    ])('writes no digit in %j', (text) => {
      expect(digitsIn(itn(text))).toEqual([]);
    });

    it('does not let a unit vouch for the NEXT number', () => {
      // Vietnamese puts the classifier after its number, so `đồng` closes
      // `850.000` and says nothing about what follows. Reading it as evidence
      // typeset the article: `850.000 đồng 1 đêm`.
      expect(itn('giá phòng là tám trăm năm mươi nghìn đồng một đêm')).toBe(
        'giá phòng là 850.000 đồng một đêm',
      );
    });

    it('refuses three numbers rather than merging them into a fourth', () => {
      // `mười` is ten and takes no multiplier — `hai mười` is not Vietnamese.
      // Read as one span this came back as 43, a number nobody said.
      expect(itn('mười một mười hai mười ba')).toBe(
        'mười một mười hai mười ba',
      );
    });

    it('takes nothing from a run it could not parse as a whole', () => {
      // Retrying from the middle would typeset the tail of a span whose whole
      // made no sense: `MƯỜI MỘT MƯỜI HAI 13`.
      expect(digitsIn(itn('mười một mười hai mười ba'))).toEqual([]);
    });

    it('leaves a separated digit readout as words, the cost this design accepted', () => {
      // Half-typesetting it (`số không 8`) is worse than not touching it.
      expect(itn('số không không tám')).toBe('số không không tám');
      expect(itn('không độ')).toBe('không độ');
    });
  });

  describe('needs evidence before a lone number word becomes a digit', () => {
    it('accepts a true classifier', () => {
      expect(itn('có ba người ở đây')).toBe('có 3 người ở đây');
      expect(itn('một cái bánh')).toBe('1 cái bánh');
      expect(itn('nó năm tuổi rồi')).toBe('nó 5 tuổi rồi');
    });

    it('accepts an identifier marker', () => {
      // The D7 regression case: `số` and `ba` are both `filler` to the guard, so
      // the guard's own tiers give this span zero anchors and lose the numeral.
      expect(itn('cổng số ba')).toBe('cổng số 3');
      expect(itn('xe buýt số ba mươi hai')).toBe('xe buýt số 32');
    });

    it('accepts a weak positional noun for an UNAMBIGUOUS digit', () => {
      expect(itn('phòng họp tầng bảy')).toBe('phòng họp tầng 7');
    });

    it('refuses a weak positional noun for an AMBIGUOUS one', () => {
      // What follows `phòng` is as often a name as a number.
      expect(digitsIn(itn('gõ cửa phòng ba'))).toEqual([]);
    });

    it('refuses a lone number word with nothing beside it', () => {
      expect(digitsIn(itn('le hai dấm dúi'))).toEqual([]);
    });
  });

  describe('dates', () => {
    it('keeps the spoken marker and zero-pads day and month', () => {
      expect(itn('ngày mười hai tháng mười')).toBe('ngày 12/10');
    });

    it('builds a date whose numerals are ALL ambiguous', () => {
      // `ngày`, `năm`, `tháng` and `một` are every one of them `filler` to the
      // guard, so this date gets no span at all under the guard's tiers. It is
      // the case the whole D7 re-derivation exists for.
      expect(itn('trong ngày năm tháng một')).toBe('trong ngày 05/01');
    });

    it('separates a year from a month even though `năm` is also the digit five', () => {
      // The month run greedily swallows the whole year and reads 951945; every
      // over-long reading is out of range and the first in-range one is right.
      expect(itn('ngày mùng hai tháng chín năm một chín bốn năm')).toBe(
        'ngày mùng 02/09/1945',
      );
    });

    it('does not fire on a `ngày` that introduces no number', () => {
      expect(itn('giao trước ngày mai')).toBe('giao trước ngày mai');
    });

    it('reads a month AFTER its number as a duration, not a date', () => {
      expect(itn('hoàn thành trong mười tám tháng')).toBe(
        'hoàn thành trong 18 tháng',
      );
    });
  });

  describe('clocks', () => {
    it('writes a bare hour as H:00, with the hour NOT zero-padded', () => {
      expect(itn('mười bảy giờ')).toBe('17:00');
      expect(itn('lúc bảy giờ')).toBe('lúc 7:00');
    });

    it('reads minutes and drops the minute marker', () => {
      expect(itn('sáu giờ bốn mươi lăm phút')).toBe('6:45');
      expect(itn('mười bốn giờ ba mươi phút')).toBe('14:30');
    });

    it('reads a two-digit minute readout', () => {
      // `năm năm` = 55 and `bốn năm` = 45. Inside a clock the ambiguity rule is
      // waived, because `giờ` has already established a number is being spoken.
      expect(itn('tám giờ năm năm phút')).toBe('8:55');
      expect(itn('mười giờ bốn năm')).toBe('10:45');
    });

    it('refuses the same two words with no clock around them', () => {
      // `năm năm` is far commoner as "five years".
      expect(digitsIn(itn('năm năm'))).toEqual([]);
    });

    it('shrinks an impossible minute rather than swallowing the next word', () => {
      // A real decoder error: `nghỉ` came out as `nghìn`. Read greedily the
      // minute is 30,000.
      expect(itn('mười một giờ ba mươi nghìn giữa giờ')).toBe(
        '11:30 nghìn giữa giờ',
      );
    });

    it('reads half past', () => {
      expect(itn('hai giờ rưỡi')).toBe('2:30');
    });

    it('does not fire on a `giờ` with no hour before it', () => {
      expect(digitsIn(itn('nghỉ giữa giờ'))).toEqual([]);
    });
  });

  describe('decimals and quantities', () => {
    it('writes the decimal as a comma and absorbs a leading zero', () => {
      expect(itn('không phẩy bốn mét')).toBe('0,4 mét');
      expect(itn('ba mươi mốt phẩy năm độ c')).toBe('31,5 độ c');
      expect(itn('sáu mươi hai phẩy tư ki lô gam')).toBe('62,4 ki lô gam');
    });

    it('groups thousands with a dot', () => {
      expect(itn('hai mươi lăm nghìn đồng')).toBe('25.000 đồng');
      expect(itn('một trăm hai mươi nghìn đồng')).toBe('120.000 đồng');
    });

    it('parses a compound whose tail attaches to an earlier scale', () => {
      // The prototype emitted `2.000 500` here — a PARTIAL parse published as
      // two fragments, which is the failure the one-span-one-numeral rule bans.
      expect(itn('hai nghìn năm trăm')).toBe('2.500');
      expect(itn('hai nghìn năm trăm tỷ đồng')).toBe('2.500 tỷ đồng');
    });

    it('leaves a written scale word as a word', () => {
      // Vietnamese writes `2.500 tỷ`, not the thirteen digits that number has.
      expect(itn('hai nghìn năm trăm tỷ')).toBe('2.500 tỷ');
    });

    it('does not group an identifier', () => {
      expect(itn('đơn hàng số bốn nghìn bốn trăm bảy mươi hai')).toBe(
        'đơn hàng số 4472',
      );
    });

    it('does not group a year', () => {
      expect(itn('sinh năm một chín mười ba')).toBe('sinh năm 1913');
    });

    it('reads the empty hundreds place that every year 2001-2099 is spoken with', () => {
      // `không trăm` is interior to the numeral here, not a negation — the one
      // shape where a `neverAlone` word may sit inside a span. Stopping growth
      // at it stranded the tail: `2000 không trăm hai mươi sáu`.
      expect(itn('năm hai nghìn không trăm hai mươi sáu')).toBe('năm 2026');
      expect(
        itn('ngày ba mươi tháng sáu năm hai nghìn không trăm hai mươi sáu'),
      ).toBe('ngày 30/06/2026');
    });

    it('still stops at a `không` that is a negation, not an empty place', () => {
      expect(itn('hai mươi không đủ')).toBe('20 không đủ');
    });

    it('reads a year spoken as two two-digit groups', () => {
      // The digit-string grammar rejects `mười`, so `19|13` needs its own
      // reading or this is unreachable.
      expect(itn('năm một chín mười ba')).toBe('năm 1913');
      expect(itn('năm một chín bốn năm')).toBe('năm 1945');
    });
  });

  describe('the properties the display depends on', () => {
    it('A3 — is byte-identical over 100 runs', () => {
      const text =
        'ngày mùng hai tháng chín năm một chín bốn năm lúc mười bảy giờ ba mươi phút';
      const first = itn(text);
      for (let run = 0; run < 100; run += 1) expect(itn(text)).toBe(first);
    });

    it('A4 — emits no alternative convention', () => {
      const corpus = [
        'mười bảy giờ',
        'sáu giờ bốn mươi lăm phút',
        'ngày mười hai tháng mười',
        'trong ngày năm tháng một',
        'ba giờ đến sáu giờ hai mươi phút',
      ].map(itn);
      for (const line of corpus) {
        expect(line).not.toMatch(/\d+\s*giờ/);
        expect(line).not.toMatch(/\d+\s*phút/);
        expect(line).not.toMatch(/tháng\s+\d+\s+năm\s+\d/);
      }
    });

    it('A7 — adds well under 5 ms at p95', () => {
      const text =
        'ghi nhận lúc mười bảy giờ mực nước trên đường phạm văn bạch dâng không phẩy bốn mét ' +
        'giao thông tê liệt gần ba mươi phút ngày mùng hai tháng chín năm một chín bốn năm';
      const samples: number[] = [];
      for (let run = 0; run < 200; run += 1) {
        const started = performance.now();
        itn(text);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      expect(samples[Math.ceil(samples.length * 0.95) - 1]).toBeLessThan(5);
    });

    it('returns a transcript with no numbers in it byte-identical', () => {
      // What lets the caller emit a display value ONLY when something changed,
      // instead of putting a "show original" disclosure under every line.
      const text = 'tôi sinh ra ở đà nẵng nhưng lớn lên tại sài gòn';
      expect(itn(text)).toBe(text);
    });

    it('is total on the inputs a live transcript actually produces', () => {
      for (const text of ['', '   ', '...', 'a', '17:00 rồi']) {
        expect(() => itn(text)).not.toThrow();
      }
    });

    it('never assembles a numeral across a sentence boundary', () => {
      // `hai` and `mươi` are one number only if nothing separates them.
      expect(itn('có hai. mươi người')).toBe('có hai. mươi người');
    });

    it('preserves the words it does not digitize, including their case', () => {
      expect(itn('Ghi nhận lúc mười bảy giờ tại Hà Nội')).toBe(
        'Ghi nhận lúc 17:00 tại Hà Nội',
      );
    });
  });
});
