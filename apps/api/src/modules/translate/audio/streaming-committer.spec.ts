import { describe, expect, it } from 'vitest';
import { StreamingCommitter } from './streaming-committer';

/** Feeds a run of guesses and hands back the committer to assert on. */
function feed(hypotheses: string[], holdBackSyllables?: number) {
  const committer = new StreamingCommitter(
    holdBackSyllables === undefined ? {} : { holdBackSyllables },
  );
  for (const hypothesis of hypotheses) committer.push(hypothesis);
  return committer;
}

describe('StreamingCommitter', () => {
  describe('settling', () => {
    it('settles nothing from a single guess', () => {
      const committer = feed(['xin chào các bạn']);
      expect(committer.committed).toBe('');
      expect(committer.pending).toBe('xin chào các bạn');
    });

    it('settles the whole guess when two reads agree exactly', () => {
      const committer = feed(['xin chào', 'xin chào']);
      expect(committer.committed).toBe('xin chào');
      expect(committer.pending).toBe('');
    });

    it('stops at a word boundary rather than settling half a word', () => {
      const committer = feed(['xin chào các', 'xin chào cách']);
      expect(committer.committed).toBe('xin chào');
      expect(committer.pending).toBe(' cách');
    });

    // The boundary test asks "is this character whitespace", so the cut must
    // too. Cutting at the last ' ' instead treats a tab as part of a word and
    // throws away the syllable before it — 'xin chào' here would come back as
    // 'xin'. Today's sidecar separates with single spaces, which is exactly why
    // a dependency on that would go unnoticed.
    it('treats any whitespace as a word boundary, not only a space', () => {
      const committer = feed(['xin chào\ttôi', 'xin chào\ttối']);
      expect(committer.committed).toBe('xin chào');
    });

    it('reports pending against the newest guess', () => {
      const committer = feed(['xin chào', 'xin chào', 'xin chào các bạn']);
      expect(committer.committed).toBe('xin chào');
      expect(committer.pending).toBe(' các bạn');
    });

    it('says whether the settled text moved', () => {
      const committer = new StreamingCommitter();
      expect(committer.push('xin chào')).toBe(false);
      expect(committer.push('xin chào')).toBe(true);
      expect(committer.push('xin chào')).toBe(false);
    });

    it('survives empty and whitespace-only guesses', () => {
      const committer = feed(['', '   ', '']);
      expect(committer.committed).toBe('');
      expect(committer.pending).toBe('');
    });
  });

  describe('correcting settled text', () => {
    it('replaces settled text when two reads agree it was wrong', () => {
      // The measured case: the recogniser offers "cơ" twice, which is enough to
      // settle it, then corrects itself to "cô cứ nhè".
      const committer = feed(['cơ', 'cơ', 'cô cứ nhè', 'cô cứ nhè']);
      expect(committer.committed).toBe('cô cứ nhè');
      expect(committer.reanchors).toBe(1);
      expect(committer.pending).toBe('');
    });

    // Guards the retreat clause in `settle`. If that clause is removed this
    // test fails, which is the point: without it the settled text shrinks on a
    // single dissenting read and the replacement count stops telling the truth.
    it('ignores a disagreement only one read has seen', () => {
      const committer = feed(['xin chào', 'xin chào', 'chào bạn ơi']);
      expect(committer.committed).toBe('xin chào');
      expect(committer.reanchors).toBe(0);
      // Nothing is shown beyond the settled text for this one read, rather than
      // showing words that would appear twice once the guess is confirmed.
      expect(committer.pending).toBe('');
    });

    it('does not shrink when a later prefix merely agrees with less', () => {
      const committer = feed([
        'một hai ba',
        'một hai ba',
        'một hai',
        'một hai',
      ]);
      expect(committer.committed).toBe('một hai ba');
      expect(committer.reanchors).toBe(0);
    });

    it('never renders a settled phrase twice after re-anchoring', () => {
      const committer = feed([
        'một hai ba',
        'một hai ba',
        'hai ba bốn',
        'hai ba bốn',
      ]);
      const line = committer.committed + committer.pending;
      expect(line.split('hai ba').length - 1).toBe(1);
    });
  });

  describe('holding back', () => {
    it('withholds the trailing syllables when asked', () => {
      const committer = feed(['a b c d', 'a b c d'], 2);
      expect(committer.committed).toBe('a b');
      expect(committer.pending).toBe(' c d');
    });

    it('withholds nothing by default', () => {
      const committer = feed(['a b c d', 'a b c d']);
      expect(committer.committed).toBe('a b c d');
    });

    // Cut out of the original string, never rebuilt from its tokens. Rejoining
    // would normalise the recogniser's own spacing, and settled text that is no
    // longer a prefix of the reading it came from makes `pending` go empty.
    it('keeps the settled text a prefix of the guess it came from', () => {
      const committer = feed(['a  b  c  d', 'a  b  c  d'], 2);
      expect(committer.committed).toBe('a  b');
      expect(committer.pending).toBe('  c  d');
    });
  });

  describe('text written without spaces', () => {
    // Chinese has no whitespace, so a whitespace-only boundary would commit
    // nothing at all until the final. Each Han character is a syllable.
    it('settles the agreed Chinese prefix up to the last shared character', () => {
      const committer = feed(['我们明天去北京开会', '我们明天去北京吧']);
      expect(committer.committed).toBe('我们明天去北京');
      expect(committer.pending).toBe('吧');
    });

    it('settles identical Chinese reads whole', () => {
      const committer = feed(['我们明天去北京开会', '我们明天去北京开会']);
      expect(committer.committed).toBe('我们明天去北京开会');
    });

    it('still drops half a Latin word inside Chinese text', () => {
      const committer = feed(['我们用iPhone', '我们用iPad']);
      expect(committer.committed).toBe('我们用');
    });

    it('keeps the Chinese before a Latin word that is still growing', () => {
      const committer = feed(['我们去a', '我们去b']);
      expect(committer.committed).toBe('我们去');
    });

    it('withholds one Han character per held syllable', () => {
      const committer = feed(['我们明天去', '我们明天去'], 2);
      expect(committer.committed).toBe('我们明');
      expect(committer.pending).toBe('天去');
    });
  });

  describe('reset', () => {
    it('clears settled text, pending text and the replacement count', () => {
      const committer = feed(['cơ', 'cơ', 'cô cứ nhè', 'cô cứ nhè']);
      expect(committer.reanchors).toBe(1);
      committer.reset();
      expect(committer.committed).toBe('');
      expect(committer.pending).toBe('');
      expect(committer.reanchors).toBe(0);
    });
  });
});
