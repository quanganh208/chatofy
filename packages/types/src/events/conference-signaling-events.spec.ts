import { describe, expect, it } from 'vitest';
import {
  CONFERENCE_ERROR_CODES,
  ConferenceMediaPublishSchema,
  ConferenceMediaSubscribeReplySchema,
  MAX_CONFERENCE_SDP_CHARS,
  withPublishVideoCodecFirst,
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

  it('accepts a retry delay within bounds and refuses one outside them', () => {
    const reply = (retryAfterMs: number) =>
      ConferenceMediaSubscribeReplySchema.safeParse({ sdp: null, mids: [], retryAfterMs }).success;
    expect(reply(1000)).toBe(true);
    expect(reply(99)).toBe(false);
    expect(reply(10_001)).toBe(false);
    expect(reply(1000.5)).toBe(false);
  });
});

describe('CONFERENCE_ERROR_CODES', () => {
  it('names SFU failures and no longer carries the old transport error code', () => {
    expect(CONFERENCE_ERROR_CODES).toContain('sfu_unavailable');
    expect(CONFERENCE_ERROR_CODES).not.toContain('transport_exists');
  });
});

describe('withPublishVideoCodecFirst', () => {
  it('moves VP8 ahead of H264 and keeps every other codec in order', () => {
    const codecs = [
      { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' },
      { mimeType: 'video/rtx' },
      { mimeType: 'video/VP9' },
      { mimeType: 'video/VP8' },
      { mimeType: 'video/AV1' },
    ];
    expect(withPublishVideoCodecFirst(codecs).map((c) => c.mimeType)).toEqual([
      'video/VP8',
      'video/H264',
      'video/rtx',
      'video/VP9',
      'video/AV1',
    ]);
  });

  it('matches the mime type case-insensitively and leaves a list without VP8 alone', () => {
    expect(
      withPublishVideoCodecFirst([{ mimeType: 'video/H264' }, { mimeType: 'video/vp8' }])[0]!
        .mimeType,
    ).toBe('video/vp8');
    expect(withPublishVideoCodecFirst([{ mimeType: 'video/H264' }])).toEqual([
      { mimeType: 'video/H264' },
    ]);
  });
});
