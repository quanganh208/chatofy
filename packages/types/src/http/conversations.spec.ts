import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMITS,
  saveConversationTurnSchema,
  saveConversationRequestSchema,
  uploadConversationAudioQuerySchema,
} from './conversations.js';

/** A turn the schema accepts, so each case can vary one field. */
const turn = (over: Record<string, unknown> = {}) => ({
  position: 0,
  speakerRole: 'speaker_a',
  speakerLabel: null,
  sourceText: 'xin chào',
  displayText: null,
  targetText: 'hello',
  offsetMs: 1_200,
  ...over,
});

describe('saveConversationTurnSchema.offsetMs', () => {
  it('accepts null — the client had no capture record for the block', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: null })).success).toBe(true);
  });

  it('accepts zero and the duration ceiling', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: 0 })).success).toBe(true);
    expect(
      saveConversationTurnSchema.safeParse(turn({ offsetMs: HISTORY_LIMITS.MAX_DURATION_MS }))
        .success,
    ).toBe(true);
  });

  it('refuses a negative offset', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: -1 })).success).toBe(false);
  });

  it('refuses a non-integer offset', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: 12.5 })).success).toBe(false);
  });

  it('refuses an offset past the duration ceiling', () => {
    // The value is client-reported; unbounded, it renders a time measured in years.
    expect(
      saveConversationTurnSchema.safeParse(turn({ offsetMs: HISTORY_LIMITS.MAX_DURATION_MS + 1 }))
        .success,
    ).toBe(false);
  });

  it('accepts a body with no offset at all, and reads it as null', () => {
    // The stale-bundle case, and the reason this field is optional rather than
    // required-nullable: a browser holding the previous bundle keeps sending
    // bodies without it for as long as its tab stays open, and refusing those
    // would lose the conversation rather than the timestamp.
    const { offsetMs: _omitted, ...without } = turn();
    const parsed = saveConversationTurnSchema.safeParse(without);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.offsetMs).toBeNull();
  });
});

describe('saveConversationRequestSchema', () => {
  const body = (turns: unknown[]) => ({
    direction: 'vi_to_en',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    turns,
  });

  it('accepts offsets that run backwards across positions', () => {
    // Deliberate. An earlier draft refined these to be non-decreasing, which
    // made ONE bad offset cost the WHOLE transcript — a 400 on a body whose text
    // was perfectly good. A timestamp that disagrees with its neighbours is a
    // wrong number in a gutter; a refused save is a lost conversation.
    const parsed = saveConversationRequestSchema.safeParse(
      body([turn({ position: 0, offsetMs: 9_000 }), turn({ position: 1, offsetMs: 1_000 })]),
    );
    expect(parsed.success).toBe(true);
  });

  it('still refuses a body over the total character ceiling', () => {
    // The offset field must not have weakened the bound that actually protects
    // the row.
    const huge = 'x'.repeat(HISTORY_LIMITS.MAX_TURN_CHARS);
    const turns = Array.from({ length: 40 }, (_unused, position) =>
      turn({ position, sourceText: huge, displayText: huge, targetText: huge }),
    );
    expect(saveConversationRequestSchema.safeParse(body(turns)).success).toBe(false);
  });
});

describe('uploadConversationAudioQuerySchema', () => {
  it('coerces the query strings a URL actually carries', () => {
    const parsed = uploadConversationAudioQuerySchema.safeParse({
      offsetMs: '1200',
      durationMs: '65000',
    });
    expect(parsed.success && parsed.data).toEqual({ offsetMs: 1_200, durationMs: 65_000 });
  });

  it('refuses a negative or absent duration', () => {
    expect(
      uploadConversationAudioQuerySchema.safeParse({ offsetMs: '0', durationMs: '-1' }).success,
    ).toBe(false);
    expect(uploadConversationAudioQuerySchema.safeParse({ offsetMs: '0' }).success).toBe(false);
  });
});

describe('HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES', () => {
  it('is the 32 MB the recorder bitrate was chosen against', () => {
    // Read from the shared constant rather than hard-coded: a hard-coded 24_000
    // here would stay green if the recorder's own bitrate changed and broke this
    // pairing, which is exactly the drift `AUDIO_RECORDER_BITS_PER_SECOND` being
    // exported exists to make visible.
    expect(HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES).toBe(32 * 1024 * 1024);
    const secondsAtRecorderBitrate =
      HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES /
      (HISTORY_LIMITS.AUDIO_RECORDER_BITS_PER_SECOND / 8);
    expect(Math.round(secondsAtRecorderBitrate)).toBe(11_185);
    expect(secondsAtRecorderBitrate).toBeGreaterThan(3 * 3600);
  });

  it('stays under the duration ceiling a lying clock could claim', () => {
    expect(HISTORY_LIMITS.MAX_DURATION_MS).toBeGreaterThan(
      (HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES /
        (HISTORY_LIMITS.AUDIO_RECORDER_BITS_PER_SECOND / 8)) *
        1_000,
    );
  });
});
