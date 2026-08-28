import { MAX_REPAIR_DIVERGENCE, repairDivergence } from '@chatofy/ai-providers';

/**
 * The guard that decides whether a repaired transcript may be shown.
 *
 * Its failure mode is silent — a paraphrase it lets through is a fluent sentence
 * on screen, in the right language, attributed to a speaker who never said it —
 * so the cases below are written as two opposing duties. It must forgive the
 * numeral rewrites the feature exists to produce, and it must catch a changed
 * word however small the change.
 *
 * Every "legitimate" pair here is a real one: a raw string this repo's Vietnamese
 * recognizer actually produced for the display-fidelity corpus, beside what
 * `gemma-4-31b-it` actually returned for it. Invented pairs would only prove the
 * guard agrees with whatever the test author imagined.
 */
describe('repairDivergence', () => {
  const residual = (
    raw: string,
    repaired: string,
    language: 'vi' | 'en' = 'vi',
  ) => repairDivergence(raw, repaired, language).residual;

  describe('forgives a number becoming a numeral', () => {
    it('collapses a spoken clock time', () => {
      expect(
        residual(
          'Ghi nhận lúc mười bảy giờ mực nước trên đường phạm văn bạch dâng không phẩy bốn mét',
          'Ghi nhận lúc 17:00, mực nước trên đường Phạm Văn Bạch dâng 0,4 mét.',
        ),
      ).toBe(0);
    });

    it('collapses a spoken date, nine tokens into one', () => {
      expect(
        residual(
          'Ngày mùng hai tháng chín năm một chín bốn lăm tại quảng trường ba đình',
          'Ngày 2/9/1945, tại Quảng trường Ba Đình.',
        ),
      ).toBe(0);
    });

    it('forgives a lone ambiguous word next to number vocabulary', () => {
      // `ba` is "three" and also "dad", so it cannot vouch for itself. `số`
      // beside it is what identifies this as a number. Real corpus row.
      expect(
        residual(
          'Anh nguyễn văn minh đã chờ ở cổng số ba hơn bốn mươi lăm phút rồi',
          'Anh Nguyễn Văn Minh đã chờ ở cổng số 3 hơn 45 phút rồi.',
        ),
      ).toBe(0);
    });

    it('forgives a unit abbreviated on the repaired side', () => {
      // The recognizer spells `mét` out and the repair may write `m`. This is
      // the exact rendering the plan's reproduction passage asks for, so a
      // guard that scored it as a paraphrase would reject the feature's own demo.
      expect(
        residual('nước ngập sâu không phẩy bốn mét', 'Nước ngập sâu 0,4 m.'),
      ).toBe(0);
    });

    it('forgives English numerals, so en_to_vi is not rejected wholesale', () => {
      expect(
        residual(
          'the meeting is at five p m on june third',
          'The meeting is at 5 PM on June 3.',
          'en',
        ),
      ).toBe(0);
    });
  });

  describe('catches a word the speaker did not say', () => {
    // `không` is the word for zero AND the ordinary Vietnamese negation, so
    // digitizing it reverses what the speaker said while looking like the
    // feature working. Three separate shapes reach it and each defeated the fix
    // for the one before, so all three are pinned here.
    //
    // Several neighbours rather than one, because an earlier version of this
    // suite tested only `không phải` and stayed green while `tôi không đồng ý`
    // → `Tôi 0 đồng ý.` sailed through at 0.0000 — it had picked, by accident,
    // the one neighbour outside the number vocabulary. A single case for a rule
    // that depends on context tests a context, not the rule.
    it.each([
      ['tôi không phải người hà nội', 'Tôi 0 phải người Hà Nội.'],
      // `đồng`, `ngày` and `số` are all number vocabulary, so each vouches for
      // the span beside it.
      ['tôi không đồng ý', 'Tôi 0 đồng ý.'],
      ['ngày không đủ nắng', 'Ngày 0 đủ nắng.'],
      ['số không đúng', 'Số 0 đúng.'],
    ])('scores the negation-to-zero hallucination: %s', (raw, repaired) => {
      expect(residual(raw, repaired)).toBeGreaterThan(0);
    });

    // The second hole: `không` swept INTO a span that already contains a
    // counting word, riding on someone else's justification rather than needing
    // a neighbour of its own.
    it.each([
      ['hai mươi không đủ', '20 0 đủ.'],
      ['lúc mười giờ không phải mười một giờ', 'Lúc 10:00 0 phải 11:00.'],
      ['mười lăm phút không đủ', '15 phút 0 đủ.'],
      ['tôi không có mười', 'Tôi 0 có 10.'],
    ])('scores a negation swept into a numeral span: %s', (raw, repaired) => {
      expect(residual(raw, repaired)).toBeGreaterThan(0);
    });

    // The third hole, and the one that killed every context-based rule: the thing
    // being negated is ITSELF a number, so `không` abuts a numeral the repair is
    // already rewriting and lands in its span. No amount of looking at
    // neighbours can tell `không trăm` ("not a hundred") from a zero heading a
    // numeral — they are lexically identical. What separates them is shape: a
    // real spoken zero is absorbed INTO a numeral and never stands alone.
    it.each([
      ['nó không trăm phần trăm đúng', 'Nó 0 100 phần trăm đúng.'],
      ['tôi không hai lòng', 'Tôi 0 2 lòng.'],
      ['chuyện không mười phần chắc', 'Chuyện 0 10 phần chắc.'],
      ['không sáu tháng nào yên', '0 6 tháng nào yên.'],
    ])(
      'scores a negation abutting a number being rewritten: %s',
      (raw, repaired) => {
        expect(residual(raw, repaired)).toBeGreaterThan(0);
      },
    );

    // English has no negation that doubles as a digit, so nothing here reverses
    // a meaning — but `en_to_vi` repairs English through this same guard, and
    // the identical shape misfires on words far commoner as words than numbers.
    it.each([
      ['i want a second opinion', 'I want 1 second opinion.'],
      ['in may a storm hit', 'In 5 a storm hit.'],
      ['we march a mile', 'We 3 a mile.'],
    ])(
      'scores an English word digitized out of its ordinary sense: %s',
      (raw, repaired) => {
        expect(residual(raw, repaired, 'en')).toBeGreaterThan(0);
      },
    );

    it('leaves a preserved negation alone while digitizing beside it', () => {
      // The rule must not overshoot. `không` is KEPT here and only `mười` becomes
      // a numeral — a correct repair, and the common shape of one.
      expect(residual('tôi không đi mười lần', 'Tôi không đi 10 lần.')).toBe(0);
    });

    it('still forgives a real zero, which is absorbed into its own numeral', () => {
      // `0,4` is ONE token — the zero joined the number rather than becoming
      // one, which is the shape every genuine spoken zero takes and the shape no
      // digitized negation can. Refusing this would reject the plan's own
      // reproduction passage.
      expect(
        residual('nước ngập sâu không phẩy bốn mét', 'Nước ngập sâu 0,4 mét.'),
      ).toBe(0);
    });

    it('scores a tone substitution, which is the Vietnamese error that hides best', () => {
      // `má` and `mà` differ by one tone mark and are different words. The guard
      // must NOT use `foldForMatch`, which strips combining marks and folds them
      // together — nor `\w`, which is ASCII-only in JavaScript and splits every
      // accented syllable, folding them just as thoroughly. Both spellings were
      // in this file before measurement replaced them.
      expect(residual('con má tôi', 'Con mà tôi.')).toBeGreaterThan(0);
    });

    it('scores a swapped proper noun', () => {
      expect(
        residual(
          'tôi không phải người hà nội tôi sinh ra ở đà nẵng',
          'Tôi không phải người Hà Nội, tôi sinh ra ở Đà Lạt.',
        ),
      ).toBeGreaterThan(0);
    });

    it('scores an invented ending on a turn the ceiling cut', () => {
      // Asserted as an exact value, not merely non-zero, because the number is
      // what pins the DENOMINATOR: four words invented onto a four-word
      // transcript is one whole transcript of invention. Divided by the repaired
      // side instead — eight words — the same fabrication reads as 0.5, and a
      // guard that scores invention as half a sentence has the wrong scale.
      expect(
        residual('tôi muốn đặt một', 'Tôi muốn đặt một bàn cho hai người.'),
      ).toBe(1);
    });

    it('scores a word smuggled into the span beside a correct numeral', () => {
      // The subtlest hole this guard had. Raw side entirely counting words,
      // repaired side genuinely contains the right numeral — and `chiều`
      // ("afternoon") rides along, an inference nobody spoke. Forgiving a
      // numeral rewrite must not forgive whatever shares the span with it.
      expect(
        residual('cuộc họp lúc mười bảy giờ', 'Cuộc họp lúc 17:00 chiều.'),
      ).toBeGreaterThan(0);
    });

    it('scores number words that became words rather than digits', () => {
      // Every raw word here is number vocabulary, so the span passes every test
      // except the one that matters: nothing on the repaired side is a digit.
      // This is not a numeral being written as a numeral, it is a time being
      // replaced by a vague phrase, and the exemption must not reach it.
      expect(
        residual('cuộc họp lúc mười giờ', 'Cuộc họp lúc sáng sớm.'),
      ).toBeGreaterThan(0);
    });

    it('scores a duration written as a clock time', () => {
      // Real regression: stating the H:MM convention in the prompt made the model
      // apply it to `hai tiếng ba mươi phút` — two and a half HOURS, not 2:30.
      expect(
        residual(
          'Từ sài gòn đến vũng tàu khoảng một trăm hai mươi lăm ki lô mét đi mất hai tiếng ba mươi phút',
          'Từ Sài Gòn đến Vũng Tàu khoảng 125 km, đi mất 2:30.',
        ),
      ).toBeGreaterThan(0);
    });

    it('scores a dropped word even when a numeral is rewritten beside it', () => {
      // Real regression from the same prompt change: `trong ngày năm tháng một`
      // became `trong 5/1`, losing `ngày`. The numeral is right and a word is gone.
      expect(
        residual(
          'Bệnh viện bạch mai tiếp nhận hai trăm bốn mươi ca trong ngày năm tháng một',
          'Bệnh viện Bạch Mai tiếp nhận 240 ca trong 5/1.',
        ),
      ).toBeGreaterThan(0);
    });
  });

  describe('ignores what a repair is supposed to change', () => {
    it('scores punctuation and casing at zero', () => {
      expect(
        residual(
          'tôi không phải người hà nội tôi sinh ra ở đà nẵng',
          'Tôi không phải người Hà Nội, tôi sinh ra ở Đà Nẵng.',
        ),
      ).toBe(0);
    });

    it('keeps a recognition error the repair correctly refused to fix', () => {
      // The recognizer heard `Hồ bán kiếm` for `Hồ Hoàn Kiếm`. Rule 2 says leave
      // it, the model did, and the guard must not punish that obedience.
      expect(
        residual(
          'Hồ bán kiếm khoảng mười hai héc ta nằm giữa trung tâm hà nội',
          'Hồ Bán Kiếm khoảng 12 héc ta nằm giữa trung tâm Hà Nội.',
        ),
      ).toBe(0);
    });
  });

  describe('a quantity spoken with its classifier', () => {
    // Vietnamese puts a classifier after a number for countable nouns, so this
    // is the ordinary shape of a spoken quantity rather than an edge case. Each
    // of these was refused at the residuals below until the classifier tier
    // existed, and because the threshold is zero the refusal discarded the
    // WHOLE turn's repair — one `ba người` cost a paragraph its punctuation.
    //
    // Only the five ambiguous numerals were ever affected: `hai người` passed
    // throughout, because `hai` vouches for its own span from inside.
    it.each([
      ['có ba người ở đây', 'Có 3 người ở đây.'],
      ['nó năm tuổi rồi', 'Nó 5 tuổi rồi.'],
      ['một cái bánh', '1 cái bánh.'],
      ['đi ba lần rồi', 'Đi 3 lần rồi.'],
      ['giá năm đô la', 'Giá 5 đô la.'],
      ['có hai người ở đây', 'Có 2 người ở đây.'],
    ])('forgives %s', (raw, repaired) => {
      expect(residual(raw, repaired)).toBe(0);
    });

    it('still refuses a classifier that changed into another one', () => {
      // Why the classifiers vouch from OUTSIDE a span and never travel inside
      // it. Both sides here are number vocabulary and a digit is present, so an
      // `inSpan` classifier would have waved `người` → `ngày` through — a word
      // nobody said, in a sentence that reads perfectly.
      expect(
        repairDivergence('ba người đến', '3 ngày đến', 'vi').faithful,
      ).toBe(false);
    });

    it('still refuses a digitized negation beside a classifier', () => {
      // The shape rule consults nothing outside the span, so widening the
      // neighbour vocabulary cannot reopen the hole it closed.
      expect(
        repairDivergence('ba người không đến', '3 người 0 đến', 'vi').faithful,
      ).toBe(false);
    });

    it('forgives an English quantity spoken with its unit', () => {
      // Same gap, same fix, on the half of the product that repairs English:
      // `one` is filler, so `one person` reached no counting word and the whole
      // repair was discarded.
      expect(
        residual('one person came at nine', 'One person came at 9:00.', 'en'),
      ).toBe(0);
    });
  });

  describe('degenerate input', () => {
    it('refuses a repair of nothing', () => {
      // No words to be answerable to, so everything here is invention.
      expect(repairDivergence('', 'Xin chào.', 'vi').faithful).toBe(false);
    });

    it('accepts nothing from nothing rather than dividing by zero', () => {
      expect(residual('', '')).toBe(0);
    });
  });

  it('reports how much it forgave, so a silent exemption is visible', () => {
    // Without this the corpus calibration cannot tell "nothing changed" from
    // "nine edits were waved through".
    const scored = repairDivergence(
      'Ngày mùng hai tháng chín năm một chín bốn lăm tại quảng trường ba đình',
      'Ngày 2/9/1945, tại Quảng trường Ba Đình.',
      'vi',
    );
    expect(scored.exemptedOps).toBeGreaterThan(0);
    expect(scored.rawWords).toBe(15);
  });

  it('admits only numeral rewrites, which is what the measured threshold means', () => {
    // All 22 corpus repairs scored exactly 0.0000, so there is no tolerance to
    // spend. Pinned because raising it is a decision, not a tweak: a single
    // substituted word in a 24-word turn scores 0.042, and any allowance at all
    // would wave one through.
    expect(MAX_REPAIR_DIVERGENCE).toBe(0);
  });
});
