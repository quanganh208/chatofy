import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';
import { attributionStats, TAP_RATE_FLOOR } from './attribution-stats.js';
import type { AttributionsBySession } from './speaker-roster.js';

const segment = (sessionId: string): TranscriptSegment => ({
  id: `id-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText: 'xin chào',
  targetText: 'hello',
  audioUrl: null,
  createdAt: '2026-08-25T00:00:00.000Z',
});

const final = (sessionId: string): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: segment(sessionId),
});

const partial = (sessionId: string, text: string): ServerEvent => ({
  type: 'server.transcript.partial',
  sessionId,
  text,
  speaker: 'speaker_a',
  direction: 'vi_to_en',
});

const add = (): TurnKeyedAction => ({ type: 'transcript.speakerAdded' });

const attribute = (sessionId: string, speakerId: string): TurnKeyedAction => ({
  type: 'transcript.turnAttributed',
  sessionId,
  speakerId,
});

const play = (...actions: TurnKeyedAction[]): TurnKeyedTranscript =>
  actions.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

/**
 * A state carrying suggestions, which nothing can produce until the acoustic
 * layer exists.
 *
 * Built by hand for exactly that reason, and only for the suggestion buckets.
 * Every other case below is folded from real actions, because a selector tested
 * against a shape it will never see in production proves nothing. The honest
 * alternative here would be to invent an action that writes suggestions a phase
 * early, which is worse: it would put a way to forge a confirmation into the
 * codebase to make a test convenient.
 */
const withSuggestions = (
  state: TurnKeyedTranscript,
  attributions: AttributionsBySession,
): TurnKeyedTranscript => ({ ...state, attributions });

describe('tap rate', () => {
  it('is zero before anybody has said anything', () => {
    const stats = attributionStats(initialTurnKeyedTranscript);

    expect(stats.totalTurns).toBe(0);
    expect(stats.tapRate).toBe(0);
  });

  it('counts turns nobody attributed as untapped rather than dropping them', () => {
    const stats = attributionStats(
      play(add(), final('turn-1'), final('turn-2'), attribute('turn-1', 'speaker-1')),
    );

    expect(stats.totalTurns).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.fallback).toBe(1);
    expect(stats.tapRate).toBe(0.5);
  });

  it('ignores turns still being spoken', () => {
    // Otherwise the rate would fall every time somebody opens their mouth, and
    // the number that decides whether the acoustic layer ships would be noise.
    const stats = attributionStats(
      play(add(), final('turn-1'), attribute('turn-1', 'speaker-1'), partial('turn-2', 'đang nói')),
    );

    expect(stats.totalTurns).toBe(1);
    expect(stats.tapRate).toBe(1);
  });

  it('falls back to untapped when an attribution is cleared', () => {
    const stats = attributionStats(
      play(add(), final('turn-1'), attribute('turn-1', 'speaker-1'), {
        type: 'transcript.turnUnattributed',
        sessionId: 'turn-1',
      }),
    );

    expect(stats.confirmed).toBe(0);
    expect(stats.tapRate).toBe(0);
  });

  it('has a floor that means the design has stopped working', () => {
    expect(TAP_RATE_FLOOR).toBe(0.5);
  });
});

describe('suggestion outcomes', () => {
  it('reads zero everywhere while nothing produces suggestions', () => {
    const stats = attributionStats(play(add(), final('turn-1'), attribute('turn-1', 'speaker-1')));

    expect(stats.suggestions).toEqual({ confirmedMatching: 0, corrected: 0, unreviewed: 0 });
  });

  it('counts a suggestion nobody looked at as neither right nor wrong', () => {
    // The bucket the whole selector exists for. Folded into "accepted", a session
    // where nobody read the screen would score perfectly — which is precisely
    // the failure the suggestion design is afraid of.
    const state = withSuggestions(play(add(), final('turn-1')), {
      'turn-1': { speakerId: 'speaker-1', origin: 'suggested', suggestedSpeakerId: 'speaker-1' },
    });

    expect(attributionStats(state).suggestions).toEqual({
      confirmedMatching: 0,
      corrected: 0,
      unreviewed: 1,
    });
  });

  it('counts agreement only when somebody actually agreed', () => {
    const state = withSuggestions(play(add(), final('turn-1')), {
      'turn-1': { speakerId: 'speaker-1', origin: 'confirmed', suggestedSpeakerId: 'speaker-1' },
    });

    expect(attributionStats(state).suggestions.confirmedMatching).toBe(1);
  });

  it('counts a different choice as a correction', () => {
    const state = withSuggestions(play(add(), add(), final('turn-1')), {
      'turn-1': { speakerId: 'speaker-2', origin: 'confirmed', suggestedSpeakerId: 'speaker-1' },
    });

    expect(attributionStats(state).suggestions.corrected).toBe(1);
    expect(attributionStats(state).suggestions.confirmedMatching).toBe(0);
  });

  it('counts rejecting a suggestion outright as a correction', () => {
    // Choosing nobody over a proposed name is the strongest evidence a
    // suggestion was wrong. The reducer keeps the row alive for this turn alone
    // so the evidence is not thrown away with the label.
    const suggested = withSuggestions(play(add(), final('turn-1')), {
      'turn-1': { speakerId: 'speaker-1', origin: 'suggested', suggestedSpeakerId: 'speaker-1' },
    });
    const rejected = turnKeyedTranscriptReducer(suggested, {
      type: 'transcript.turnUnattributed',
      sessionId: 'turn-1',
    });

    expect(attributionStats(rejected).suggestions).toEqual({
      confirmedMatching: 0,
      corrected: 1,
      unreviewed: 0,
    });
    expect(attributionStats(rejected).confirmed).toBe(0);
  });

  it('keeps the suggestion after a person overrules it', () => {
    const suggested = withSuggestions(play(add(), add(), final('turn-1')), {
      'turn-1': { speakerId: 'speaker-1', origin: 'suggested', suggestedSpeakerId: 'speaker-1' },
    });
    const corrected = turnKeyedTranscriptReducer(suggested, attribute('turn-1', 'speaker-2'));

    expect(corrected.attributions['turn-1']?.suggestedSpeakerId).toBe('speaker-1');
  });

  it('ignores turns that never carried a suggestion', () => {
    const state = withSuggestions(play(add(), final('turn-1'), final('turn-2')), {
      'turn-1': { speakerId: 'speaker-1', origin: 'confirmed' },
    });

    expect(attributionStats(state).suggestions).toEqual({
      confirmedMatching: 0,
      corrected: 0,
      unreviewed: 0,
    });
  });
});
