import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { vi } from './vi.js';
import { meetingDuration, meetingLanguages, meetingParticipants } from './meeting-summary.js';
import { createTranslator } from './t.js';

const tEn = createTranslator(en);
const tVi = createTranslator(vi);

describe('meetingDuration', () => {
  it('says there is no end yet while someone is still in the room', () => {
    expect(meetingDuration(tEn, null)).toBe('Not recorded');
  });

  it('switches to hours at an hour', () => {
    expect(meetingDuration(tEn, 59)).toBe('59 min');
    expect(meetingDuration(tEn, 125)).toBe('2 h 5 min');
  });
});

describe('meetingParticipants', () => {
  it('names a blank participant as a guest', () => {
    expect(meetingParticipants(tEn, ['Alice', '  ', undefined, null])).toBe(
      'Alice, Guest, Guest, Guest',
    );
  });

  it('reads as a dash when nobody is listed', () => {
    expect(meetingParticipants(tEn, [])).toBe('—');
  });
});

describe('meetingLanguages', () => {
  it('names each language once, in first-seen order and the reader’s locale', () => {
    expect(meetingLanguages(tEn, ['en', 'vi', 'en'])).toBe('English ↔ Vietnamese');
    expect(meetingLanguages(tVi, ['vi', 'en'])).toBe('Tiếng Việt ↔ Tiếng Anh');
  });

  it('lists three or more with commas', () => {
    expect(meetingLanguages(tEn, ['vi', 'en', 'zh'])).toBe('Vietnamese, English, Chinese');
  });

  it('leaves out a code it cannot name rather than printing it', () => {
    expect(meetingLanguages(tEn, ['vi', 'xx'])).toBe('Vietnamese');
    expect(meetingLanguages(tEn, ['xx'])).toBe('—');
  });
});
