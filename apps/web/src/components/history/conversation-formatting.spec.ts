import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { durationMinutes } from './conversation-formatting';

/**
 * The rounding the history row prints, pinned because the docblock above it was
 * describing a different function.
 *
 * It said "rounded up" while the code rounds to nearest, and the two agree on the
 * only example the comment gave — a 40-second conversation, which the floor
 * rescues either way. They disagree everywhere else, so nothing was catching it.
 */

const conversation = (startedAt: string, endedAt: string): ConversationSummary => ({
  conversationId: '11111111-1111-4111-8111-111111111111',
  direction: 'vi_to_en',
  startedAt,
  endedAt,
  turnCount: 1,
  preview: 'xin chào',
  hasMinutes: false,
});

describe('durationMinutes', () => {
  it('rounds to the nearest whole minute', () => {
    // 6m10s. Rounded UP this would read "7 min" — a length overstated by more
    // than a tenth of itself.
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:06:10.000Z')),
    ).toBe(6);
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:06:50.000Z')),
    ).toBe(7);
  });

  it('never reads "0 min", however short the conversation was', () => {
    // The floor, not the rounding, is what does this.
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:00:40.000Z')),
    ).toBe(1);
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:00:01.000Z')),
    ).toBe(1);
  });
});
