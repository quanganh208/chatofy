import { describe, expect, it } from 'vitest';
import { MeetingTranscript } from './meeting-transcript';

/**
 * Two directions read as one conversation, or they do not read at all.
 */

const said = (transcript: MeetingTranscript, direction: 'inbound' | 'outbound', id: string) => {
  transcript.apply(direction, {
    type: 'server.transcript.partial',
    sessionId: id,
    text: id,
    speaker: 'speaker_a',
    direction: direction === 'inbound' ? 'en_to_vi' : 'vi_to_en',
  });
};

/** A finished turn, real enough to exercise the language-keyed read. */
const finished = (
  transcript: MeetingTranscript,
  direction: 'inbound' | 'outbound',
  id: string,
  sourceText: string,
  translations: Record<string, string>,
) => {
  const turnDirection = direction === 'inbound' ? 'en_to_vi' : 'vi_to_en';
  transcript.apply(direction, {
    type: 'server.transcript.final',
    sessionId: id,
    segment: {
      id: `seg-${id}`,
      sessionId: id,
      speakerRole: 'speaker_a',
      direction: turnDirection,
      sourceLanguages: [turnDirection === 'en_to_vi' ? 'en' : 'vi'],
      translations,
      sourceText,
      targetText: Object.values(translations)[0] ?? '',
      audioUrl: null,
      createdAt: '2026-09-28T00:00:00.000Z',
    },
  });
};

describe('MeetingTranscript', () => {
  it('orders both directions by when each turn was first seen', () => {
    // Concatenating the two produces two monologues: every sentence the user said
    // below every sentence said to them. Turn segments carry no timestamp, so the
    // order is recovered from first sight, which is when the speech started.
    const transcript = new MeetingTranscript();

    said(transcript, 'inbound', 'they-1');
    transcript.lines();
    said(transcript, 'outbound', 'me-1');
    transcript.lines();
    said(transcript, 'inbound', 'they-2');

    expect(transcript.lines().map((line) => line.sessionId)).toEqual(['they-1', 'me-1', 'they-2']);
  });

  it('tags each line with the side that said it', () => {
    const transcript = new MeetingTranscript();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    const origins = Object.fromEntries(
      transcript.lines().map((line) => [line.sessionId, line.origin]),
    );
    expect(origins).toEqual({ 'they-1': 'them', 'me-1': 'me' });
  });

  it('keeps what one direction said after that direction is reset', () => {
    // A dropped socket resets its own direction. The meeting's history is not
    // that direction's to take with it.
    const transcript = new MeetingTranscript();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    transcript.reset('outbound');

    expect(transcript.lines().map((line) => line.sessionId)).toEqual(['they-1']);
  });

  it('starts empty for a new meeting', () => {
    // Capturing meeting A, stopping, then capturing meeting B must not render A's
    // lines in B's overlay.
    const transcript = new MeetingTranscript();
    said(transcript, 'inbound', 'they-1');

    transcript.clear();

    expect(transcript.lines()).toEqual([]);
    expect(transcript.liveTurns).toBe(0);
  });

  it('counts open turns across both directions', () => {
    const transcript = new MeetingTranscript();
    said(transcript, 'inbound', 'they-1');
    said(transcript, 'outbound', 'me-1');

    expect(transcript.liveTurns).toBe(2);
  });

  // A finished turn's `targetText` is the pre-fan-out field; the overlay now
  // reads out of `translations` instead, keyed by the segment's OWN declared
  // direction — not by which side of the meeting spoke it, since inbound and
  // outbound translate opposite ways.
  it('reads a finished line out of the map keyed by its own direction, not the pre-fan-out field', () => {
    const transcript = new MeetingTranscript();
    finished(transcript, 'inbound', 'they-1', 'hello', { vi: 'xin chào' });
    finished(transcript, 'outbound', 'me-1', 'chào bạn', { en: 'hi there' });

    const targets = Object.fromEntries(
      transcript.lines().map((line) => [line.sessionId, line.targetText]),
    );
    expect(targets).toEqual({ 'they-1': 'xin chào', 'me-1': 'hi there' });
  });

  // A mixed turn's map can carry more than one entry; the overlay must pick the
  // ONE key its own direction names, not merely the first or only key present.
  it('picks the direction-named key out of a turn translated into more than one language', () => {
    // Inbound is `en_to_vi` (see `said`/`finished`): the target this line's OWN
    // direction names is 'vi', so that is the entry that must win even though
    // the map also carries 'en'.
    const transcript = new MeetingTranscript();
    finished(transcript, 'inbound', 'they-1', 'ship it now', {
      en: 'ship it now',
      vi: 'ship it giờ này',
    });

    expect(transcript.lines()[0]?.targetText).toBe('ship it giờ này');
  });
});
