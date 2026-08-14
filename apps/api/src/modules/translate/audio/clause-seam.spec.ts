import { matchClauseEnding } from './clause-seam';

describe('matchClauseEnding', () => {
  it('softens a period the model added to a clause the speaker did not end', () => {
    // The audible defect: synthesis takes intonation from punctuation, so a
    // period here drops the pitch and closes the phrase mid-sentence.
    expect(matchClauseEnding('Good morning.', 'Chào buổi sáng,')).toBe(
      'Good morning,',
    );
  });

  it('leaves a real sentence ending alone', () => {
    // The source says the speaker finished, so the translation is right to.
    expect(matchClauseEnding('Good morning.', 'Chào buổi sáng.')).toBe(
      'Good morning.',
    );
    expect(matchClauseEnding('Are you well?', 'Bạn khỏe không?')).toBe(
      'Are you well?',
    );
  });

  it('copies the mark the speaker actually used', () => {
    expect(matchClauseEnding('first.', 'thứ nhất;')).toBe('first;');
    expect(matchClauseEnding('as follows.', 'như sau:')).toBe('as follows:');
  });

  it('adds the continuation mark when the translation has none', () => {
    expect(matchClauseEnding('good morning', 'Chào buổi sáng,')).toBe(
      'good morning,',
    );
  });

  it('keeps a continuation mark the translation already got right', () => {
    expect(matchClauseEnding('good morning,', 'Chào buổi sáng,')).toBe(
      'good morning,',
    );
  });

  it('strips an invented ending when the source was cut mid-phrase', () => {
    // A clause released at the word-count limit has no punctuation to copy.
    // Adding one would be a guess, and this one gets spoken aloud.
    expect(matchClauseEnding('and then we went.', 'rồi chúng tôi đi')).toBe(
      'and then we went',
    );
  });

  it('never strengthens punctuation', () => {
    // A comma in the source can never become a period in the output: the source
    // is the only evidence about whether the speaker stopped.
    expect(matchClauseEnding('one, two.', 'một, hai,')).toBe('one, two,');
  });

  it('handles an empty translation without inventing punctuation', () => {
    expect(matchClauseEnding('   ', 'Chào bạn,')).toBe('');
  });

  it('collapses a run of trailing marks the model produced', () => {
    expect(matchClauseEnding('really...', 'thật ra,')).toBe('really,');
  });
});
