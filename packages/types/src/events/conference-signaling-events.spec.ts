import { describe, expect, it } from 'vitest';
import {
  CONFERENCE_ERROR_CODES,
  ConferenceMediaPublishSchema,
  ConferenceMediaSubscribeReplySchema,
  MAX_CONFERENCE_SDP_CHARS,
} from './conference-signaling-events.js';

describe('ConferenceMediaPublishSchema', () => {
  it('accepts one audio and one video track', () => {
    const parsed = ConferenceMediaPublishSchema.safeParse({
      sdp: 'v=0',
      tracks: [
        { mid: '0', kind: 'audio' },
        { mid: '1', kind: 'video' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects two tracks of the same kind', () => {
    const parsed = ConferenceMediaPublishSchema.safeParse({
      sdp: 'v=0',
      tracks: [
        { mid: '0', kind: 'audio' },
        { mid: '1', kind: 'audio' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty track list', () => {
    expect(ConferenceMediaPublishSchema.safeParse({ sdp: 'v=0', tracks: [] }).success).toBe(false);
  });

  it('rejects an SDP over the size cap', () => {
    const parsed = ConferenceMediaPublishSchema.safeParse({
      sdp: 'x'.repeat(MAX_CONFERENCE_SDP_CHARS + 1),
      tracks: [{ mid: '0', kind: 'audio' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ConferenceMediaSubscribeReplySchema', () => {
  it('accepts a null offer when there is nothing new to pull', () => {
    expect(ConferenceMediaSubscribeReplySchema.safeParse({ sdp: null, mids: [] }).success).toBe(
      true,
    );
  });
});

describe('CONFERENCE_ERROR_CODES', () => {
  it('names SFU failures and no longer carries the mediasoup transport code', () => {
    expect(CONFERENCE_ERROR_CODES).toContain('sfu_unavailable');
    expect(CONFERENCE_ERROR_CODES).not.toContain('transport_exists');
  });
});
