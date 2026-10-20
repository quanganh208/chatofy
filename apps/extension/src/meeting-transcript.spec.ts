import { describe, expect, it } from 'vitest';
import { languagePairOf, reversePair, type LanguagePair } from '@chatofy/types';
import { MeetingTranscript } from './meeting-transcript';

/**
 * Two legs read as one conversation, or they do not read at all.
 */

/** What the meeting side is translated by; the user's side runs the reverse. */
const MEETING_PAIR = languagePairOf('en', 'vi');
const pairOf = (leg: 'inbound' | 'outbound'): LanguagePair =>
  leg === 'inbound' ? MEETING_PAIR : reversePair(MEETING_PAIR);

/** A transcript for a meeting translated by {@link MEETING_PAIR}. */
const meeting = () => {
  const transcript = new MeetingTranscript();
  transcript.clear(MEETING_PAIR);
  return transcript;
};

const said = (transcript: MeetingTranscript, leg: 'inbound' | 'outbound', id: string) => {
  transcript.apply(leg, {
    type: 'server.transcript.partial',
    sessionId: id,
    text: id,
    speaker: 'speaker_a',
    languagePair: pairOf(leg),
  });
};

/** A finished turn, real enough to exercise the language-keyed read. */
const finished = (
  transcript: MeetingTranscript,
  leg: 'inbound' | 'outbound',
  id: string,
  sourceText: string,
  translations: Record<string, string>,
) => {
  transcript.apply(leg, {
    type: 'server.transcript.final',
    sessionId: id,
    segment: {
      id: `seg-${id}`,
      sessionId: id,
      speakerRole: 'speaker_a',
      sourceLanguages: [pairOf(leg).source],
      translations,
      sourceText,
      audioUrl: null,
      createdAt: '2026-09-28T00:00:00.000Z',
    },
  });
};

describe('MeetingTranscript', () => {
  it('orders both legs by when each turn was first seen', () => {
    // Concatenating the two produces two monologues: every sentence the user said
    // below every sentence said to them. Turn segments carry no timestamp, so the
    // order is recovered from first sight, which is when the speech started.
    const transcript = meeting();

    said(transcript, 'inbound', 'they-1');
    transcript.lines();
    said(transcript, 'outbound', 'me-1');
    transcript.lines();
    said(transcript, 'inbound', 'they-2');

    expect(transcript.lines().map((line) => line.sessionId)).toEqual(['they-1', 'me-1', 'they-2']);
  });

  it('tags each line with the side that said it', () => {
    const transcript = meeting();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    const origins = Object.fromEntries(
      transcript.lines().map((line) => [line.sessionId, line.origin]),
    );
    expect(origins).toEqual({ 'they-1': 'them', 'me-1': 'me' });
  });

  it('keeps what one leg said after that leg is reset', () => {
    // A dropped socket resets its own leg. The meeting's history is not
    // that leg's to take with it.
    const transcript = meeting();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    transcript.reset('outbound');

    expect(transcript.lines().map((line) => line.sessionId)).toEqual(['they-1']);
  });

  it('starts empty for a new meeting', () => {
    // Capturing meeting A, stopping, then capturing meeting B must not render A's
    // lines in B's overlay.
    const transcript = meeting();
    said(transcript, 'inbound', 'they-1');

    transcript.clear(MEETING_PAIR);

    expect(transcript.lines()).toEqual([]);
    expect(transcript.liveTurns).toBe(0);
  });

  it('counts open turns across both legs', () => {
    const transcript = meeting();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    expect(transcript.liveTurns).toBe(2);
  });

  // Keyed by the pair of the side that said it: inbound and outbound translate
  // opposite ways, so one shared target would show the user their own language.
  it("reads a finished line out of the map keyed by its side's target language", () => {
    const transcript = meeting();
    finished(transcript, 'inbound', 'they-1', 'hello', { vi: 'xin chào' });
    finished(transcript, 'outbound', 'me-1', 'chào bạn', { en: 'hi there' });

    const targets = Object.fromEntries(
      transcript.lines().map((line) => [line.sessionId, line.targetText]),
    );
    expect(targets).toEqual({ 'they-1': 'xin chào', 'me-1': 'hi there' });
  });

  // A mixed turn's map can carry more than one entry; the overlay must pick the
  // ONE key its side's pair names, not merely the first or only key present.
  it('picks the pair-named key out of a turn translated into more than one language', () => {
    // Inbound is en → vi (`MEETING_PAIR`): the target this side's pair names is
    // 'vi', so that is the entry that must win even though the map also carries
    // 'en'.
    const transcript = meeting();
    finished(transcript, 'inbound', 'they-1', 'ship it now', {
      en: 'ship it now',
      vi: 'ship it giờ này',
    });

    expect(transcript.lines()[0]?.targetText).toBe('ship it giờ này');
  });

  // The pair is the capture's, not fixed: a meeting translated the other way
  // round must read the other key.
  it('follows the pair the meeting was cleared with', () => {
    const transcript = new MeetingTranscript();
    transcript.clear(reversePair(MEETING_PAIR));
    finished(transcript, 'inbound', 'they-1', 'xin chào', { en: 'hello', vi: 'xin chào' });

    expect(transcript.lines()[0]?.targetText).toBe('hello');
  });
});
