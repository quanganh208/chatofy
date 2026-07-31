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
});
