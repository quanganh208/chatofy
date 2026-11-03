import { describe, expect, it } from 'vitest';
import { applyMorphSteps, graphemes, morphSegments, morphSteps } from './text-morph-diff';

/** Every intermediate text from `from` to `to`, one step at a time. */
function play(from: string, to: string): string[] {
  const segments = morphSegments(from, to);
  return Array.from({ length: morphSteps(segments) + 1 }, (_, done) =>
    applyMorphSteps(segments, done),
  );
}

describe('morphSegments', () => {
  it('ends exactly on the target, starting exactly from what was shown', () => {
    const cases: [string, string][] = [
      ['', 'xin chào'],
      ['xin chào', ''],
      ['mai mình đi học nhé', 'hai mình đi học nhé'],
      ['bốn giờ có mặt', '4:00 có mặt'],
      ['Hello my friend', 'Hi there my good friend'],
      ['a  b', 'a b'],
      ['  leading', 'leading  '],
    ];
    for (const [from, to] of cases) {
      const steps = play(from, to);
      expect(steps[0]).toBe(from);
      expect(steps.at(-1)).toBe(to);
    }
  });

  it('changes only the word that differs, leaving the rest in place', () => {
    const steps = play('mai mình đi học nhé', 'hai mình đi học nhé');
    expect(steps).toEqual([
      'mai mình đi học nhé',
      'ma mình đi học nhé',
      'm mình đi học nhé',
      ' mình đi học nhé',
      'h mình đi học nhé',
      'ha mình đi học nhé',
      'hai mình đi học nhé',
    ]);
  });

  it('erases a stale word fully before typing its replacement', () => {
    const steps = play('bốn giờ có mặt', '4:00 có mặt');
    const firstTyped = steps.findIndex((text) => text.startsWith('4'));
    expect(steps[firstTyped - 1]).toBe(' có mặt');
  });

  it('keeps a word still being typed instead of erasing it', () => {
    expect(morphSegments('xin chà', 'xin chào bạn')).toEqual([
      { kind: 'keep', text: 'xin chà' },
      { kind: 'change', remove: [], insert: graphemes('o bạn') },
    ]);
  });

  it('types an inserted word with its space first, so it never touches the next word', () => {
    for (const text of play('Hello my friend', 'Hi there my good friend')) {
      expect(text).not.toMatch(/[a-z]my|[a-z]friend/);
    }
  });

  it('never splits a grapheme, composed or decomposed', () => {
    const from = 'Hôm nay trời đẹp'.normalize('NFD');
    const to = 'Tiếng Việt rất hay'.normalize('NFD');
    for (const text of play(from, to)) {
      for (const g of graphemes(text)) expect(/^\p{M}/u.test(g)).toBe(false);
    }
  });
});
