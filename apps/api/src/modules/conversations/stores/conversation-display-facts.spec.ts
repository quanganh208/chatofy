import { describe, expect, it } from 'vitest';
import { conversationKind, speakersOf } from './conversation-display-facts';

describe('conversationKind', () => {
  it('reads auto-detect from the languages, whatever the mode says', () => {
    expect(conversationKind(['en', 'vi', 'zh'], 'one-way', [])).toBe(
      'auto-detect',
    );
  });

  it('takes the stored mode when there is one', () => {
    expect(conversationKind(['vi', 'en'], 'two-way', ['speaker_a'])).toBe(
      'two-way',
    );
    expect(
      conversationKind(['vi', 'en'], 'one-way', ['speaker_a', 'speaker_b']),
    ).toBe('one-way');
  });

  it('infers two-way for a legacy row only when both roles spoke', () => {
    expect(
      conversationKind(['vi', 'en'], null, ['speaker_a', 'speaker_b']),
    ).toBe('two-way');
  });

  it('reads a legacy en→vi row, whose turns are all speaker_b, as one-way', () => {
    expect(conversationKind(['en', 'vi'], null, ['speaker_b'])).toBe('one-way');
  });

  it('reads a legacy row with one role as one-way', () => {
    expect(conversationKind(['vi', 'en'], null, ['speaker_a'])).toBe('one-way');
  });
});

describe('speakersOf', () => {
  it('lists named speakers in order of first appearance', () => {
    expect(
      speakersOf([
        { speakerRole: 'speaker_b', speakerLabel: 'John', firstPosition: 3 },
        { speakerRole: 'speaker_a', speakerLabel: 'Lan', firstPosition: 0 },
      ]),
    ).toEqual({ speakerCount: 2, speakers: ['Lan', 'John'] });
  });

  it('counts one name used in both roles once', () => {
    expect(
      speakersOf([
        { speakerRole: 'speaker_a', speakerLabel: 'Lan', firstPosition: 0 },
        { speakerRole: 'speaker_b', speakerLabel: 'Lan', firstPosition: 1 },
      ]),
    ).toEqual({ speakerCount: 1, speakers: ['Lan'] });
  });

  it('counts an unnamed role without listing it', () => {
    expect(
      speakersOf([
        { speakerRole: 'speaker_a', speakerLabel: null, firstPosition: 0 },
        { speakerRole: 'speaker_b', speakerLabel: 'John', firstPosition: 1 },
      ]),
    ).toEqual({ speakerCount: 2, speakers: ['John'] });
  });

  it('lists at most four names but counts them all', () => {
    const entries = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({
      speakerRole: 'speaker_a',
      speakerLabel: name,
      firstPosition: i,
    }));
    expect(speakersOf(entries)).toEqual({
      speakerCount: 6,
      speakers: ['A', 'B', 'C', 'D'],
    });
  });
});
