import {
  AGREEMENT_DEPTH_EN,
  MAX_WORDS_WITHOUT_BOUNDARY,
  StablePrefixCommitter,
} from './stable-prefix-commit';

/** Feed a sequence of anchored reads and collect what each one released. */
function playAnchored(
  committer: StablePrefixCommitter,
  reads: string[],
): string[] {
  return reads.map((text) =>
    committer.observe({ text, coversTurnStart: true }),
  );
}

describe('StablePrefixCommitter — English, where the recogniser rewrites itself', () => {
  // The measured read sequence. Everything after "at" churned for four reads
  // before settling, and the churn is the point: none of it may be spoken.
  const MEASURED_READS = [
    'I will be there at a time',
    'I will be there at set.',
    'I will be there at seven in the morning',
    'I will be there at 7 in the Eve',
    'I will be there at seven in the evening',
  ];

  it('never speaks a word that a later read contradicts', () => {
    const committer = new StablePrefixCommitter({ language: 'en' });
    const spoken = playAnchored(committer, MEASURED_READS).join(' ').trim();
    // Whatever it chose to say, the final read must still support it.
    expect('I will be there at seven in the evening').toContain(
      spoken.replace(/\s+/g, ' '),
    );
    expect(committer.getStats().contradictions).toBe(0);
  });

  it('withholds the unstable tail while it is still changing', () => {
    const committer = new StablePrefixCommitter({ language: 'en' });
    const spoken = playAnchored(committer, MEASURED_READS.slice(0, 3)).join(
      ' ',
    );
    expect(spoken).not.toContain('time');
    expect(spoken).not.toContain('set');
    expect(spoken).not.toContain('morning');
  });

  // The failure this test exists to catch: dropping the agreement rule. With
  // depth 1 the committer speaks each read on sight, so "a time" goes out and
  // the next read contradicts it.
  it('would speak a retracted word if agreement were removed', () => {
    const reckless = new StablePrefixCommitter({
      language: 'en',
      agreementDepth: 1,
      minClauseWords: 1,
    });
    playAnchored(reckless, MEASURED_READS);
    expect(reckless.getStats().contradictions).toBeGreaterThan(0);
  });

  it('treats the seven/7 rewrite as agreement rather than a flip', () => {
    const committer = new StablePrefixCommitter({
      language: 'en',
      minClauseWords: 1,
    });
    committer.observe({ text: 'at seven in the', coversTurnStart: true });
    committer.observe({ text: 'at 7 in the', coversTurnStart: true });
    // Two reads that disagree only in spelling still count as agreeing, so the
    // shared prefix is available and nothing is recorded as contradicted.
    expect(committer.getStats().contradictions).toBe(0);
  });
});

describe('StablePrefixCommitter — Vietnamese, where the decoder only appends', () => {
  it('speaks on first sight without waiting for a second read', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    const spoken = committer.observe({
      text: 'Xin chào bạn, hôm nay thế nào?',
      coversTurnStart: true,
    });
    // Depth 1: no round of delay. English would still be silent here.
    //
    // Both clauses go out together because both are already settled — the
    // synthesizer splits them again for playback, and holding the second one
    // back would cost an extra translation request to say what we already knew.
    expect(spoken).toBe('Xin chào bạn, hôm nay thế nào?');
  });

  it('counts a contradiction instead of hiding it', () => {
    // If the streaming decoder ever did revise itself, this counter is the only
    // thing that would tell us the architectural claim is wrong.
    const committer = new StablePrefixCommitter({ language: 'vi' });
    committer.observe({ text: 'tôi muốn đặt bàn,', coversTurnStart: true });
    committer.observe({
      text: 'tôi muốn đặt bánh, hai cái',
      coversTurnStart: true,
    });
    expect(committer.getStats().contradictions).toBeGreaterThan(0);
  });

  it('does not rewind after a contradiction', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    const first = committer.observe({
      text: 'tôi muốn đặt bàn,',
      coversTurnStart: true,
    });
    const second = committer.observe({
      text: 'tôi muốn đặt bánh, hai cái nhé.',
      coversTurnStart: true,
    });
    expect(first).toBe('tôi muốn đặt bàn,');
    // The audio for "bàn," is already gone. The next commit continues after it
    // rather than re-issuing a corrected version.
    expect(second).not.toContain('bánh');
  });
});

describe('clause boundaries', () => {
  it('cuts at punctuation', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    expect(
      committer.observe({
        text: 'hôm nay trời đẹp, tôi đi chơi',
        coversTurnStart: true,
      }),
    ).toBe('hôm nay trời đẹp,');
  });

  it('cuts at a silence even without punctuation', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    expect(
      committer.observe({
        text: 'hôm nay trời đẹp',
        coversTurnStart: true,
        endsAtSilence: true,
      }),
    ).toBe('hôm nay trời đẹp');
  });

  it('cuts on word count when someone talks without pausing', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    const words = Array.from({ length: 14 }, (_, i) => `từ${i}`).join(' ');
    const spoken = committer.observe({ text: words, coversTurnStart: true });
    expect(spoken.split(' ')).toHaveLength(MAX_WORDS_WITHOUT_BOUNDARY);
  });

  it('says nothing when there is no boundary and not enough words yet', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    expect(
      committer.observe({ text: 'hôm nay trời', coversTurnStart: true }),
    ).toBe('');
  });

  it('releases the remainder at the end of the turn', () => {
    const committer = new StablePrefixCommitter({ language: 'vi' });
    committer.observe({ text: 'hôm nay trời đẹp, tôi', coversTurnStart: true });
    expect(
      committer.finalize({
        text: 'hôm nay trời đẹp, tôi đi chơi',
        coversTurnStart: true,
      }),
    ).toBe('tôi đi chơi');
  });
});

describe('windowed reads on a long turn', () => {
  // The English scheduler caps its window at the newest ~8s, so once a turn runs
  // long the read no longer starts at the turn's first word. This is the trap
  // the measurement harness fell into: aligning such a read at index 0 invents
  // contradictions that never happened.
  const committer = () =>
    new StablePrefixCommitter({
      language: 'en',
      agreementDepth: 1,
      minClauseWords: 1,
    });

  it('anchors a windowed read against what was already committed', () => {
    const c = committer();
    expect(c.observe({ text: 'one two three,', coversTurnStart: true })).toBe(
      'one two three,',
    );
    // The window has slid: this read starts at "three," not at "one".
    const spoken = c.observe({
      text: 'three, four five six,',
      coversTurnStart: false,
    });
    expect(spoken).toBe('four five six,');
    expect(c.getStats().contradictions).toBe(0);
  });

  // The failure this test exists to catch, and it is a DIFFERENT failure from
  // the missing-agreement one above: with the read misaligned to index 0, the
  // committed words no longer match and the counter fires on text nobody
  // actually changed.
  it('invents contradictions if a windowed read is treated as anchored', () => {
    const c = committer();
    c.observe({ text: 'one two three,', coversTurnStart: true });
    c.observe({ text: 'three, four five six,', coversTurnStart: true });
    expect(c.getStats().contradictions).toBeGreaterThan(0);
  });

  it('skips a read it cannot place rather than guessing', () => {
    const c = committer();
    c.observe({ text: 'one two three,', coversTurnStart: true });
    const spoken = c.observe({
      text: 'nothing here overlaps at all,',
      coversTurnStart: false,
    });
    expect(spoken).toBe('');
    expect(c.getStats().unalignableReads).toBe(1);
    expect(c.getStats().contradictions).toBe(0);
  });
});

describe('constants carry their reasoning', () => {
  it('uses a shallower English depth than a full re-read would need', () => {
    expect(AGREEMENT_DEPTH_EN).toBe(2);
  });
});
