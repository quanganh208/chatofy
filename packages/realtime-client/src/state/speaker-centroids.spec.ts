import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';
import { buildCentroids, suggestSpeaker, TAU_SUGGEST } from './speaker-centroids.js';
import { attributionFor } from './speaker-roster.js';

/**
 * The two rules the whole suggestion design rests on, and they are both about
 * authority rather than accuracy:
 *
 * 1. A suggestion never overrules a person.
 * 2. A suggestion never becomes evidence for the next suggestion.
 *
 * Break the second and one early mistake is permanent — the profile agrees with
 * itself forever, and every later turn agrees a little harder.
 */

/** A unit vector pointing along one axis, so similarity is easy to reason about. */
const axis = (index: number, dims = 4): number[] =>
  Array.from({ length: dims }, (_, position) => (position === index ? 1 : 0));

/** A vector between two axes; `blend` 0 is pure `a`, 1 is pure `b`. */
const between = (a: number, b: number, blend: number, dims = 4): number[] => {
  const raw = Array.from({ length: dims }, (_, position) =>
    position === a ? 1 - blend : position === b ? blend : 0,
  );
  const norm = Math.sqrt(raw.reduce((total, value) => total + value * value, 0));
  return raw.map((value) => value / norm);
};

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

const embedding = (sessionId: string, vector: number[], audioMs = 2000): ServerEvent => ({
  type: 'server.turn.embedding',
  sessionId,
  vector,
  dim: vector.length,
  audioMs,
});

const add = (): TurnKeyedAction => ({ type: 'transcript.speakerAdded' });

const attribute = (sessionId: string, speakerId: string): TurnKeyedAction => ({
  type: 'transcript.turnAttributed',
  sessionId,
  speakerId,
});

const play = (...actions: TurnKeyedAction[]): TurnKeyedTranscript =>
  actions.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

/** Two people confirmed on one turn each, pointing along different axes. */
const twoKnownVoices = () =>
  play(
    add(),
    add(),
    final('turn-1'),
    embedding('turn-1', axis(0)),
    attribute('turn-1', 'speaker-1'),
    final('turn-2'),
    embedding('turn-2', axis(1)),
    attribute('turn-2', 'speaker-2'),
  );

describe('building a profile', () => {
  it('uses only turns a person confirmed', () => {
    const state = play(
      add(),
      final('turn-1'),
      embedding('turn-1', axis(0)),
      attribute('turn-1', 'speaker-1'),
      final('turn-2'),
      embedding('turn-2', axis(1)),
    );

    const centroids = buildCentroids(state.speakers, state.attributions, state.embeddings);
    expect([...centroids.keys()]).toEqual(['speaker-1']);
    expect([...centroids.get('speaker-1')!]).toEqual([1, 0, 0, 0]);
  });

  it('refuses to learn from its own suggestions', () => {
    // The self-reinforcing failure. A suggestion that fed the profile would make
    // the next turn agree with it more strongly, and one early mistake would
    // never come back.
    const known = twoKnownVoices();
    const suggested = [final('turn-3'), embedding('turn-3', axis(0))].reduce(
      turnKeyedTranscriptReducer,
      known,
    );

    expect(attributionFor(suggested.attributions, 'turn-3').origin).toBe('suggested');

    const before = buildCentroids(known.speakers, known.attributions, known.embeddings);
    const after = buildCentroids(suggested.speakers, suggested.attributions, suggested.embeddings);
    expect([...after.get('speaker-1')!]).toEqual([...before.get('speaker-1')!]);
  });

  it('weights a longer turn more heavily than a short one', () => {
    // A half-second turn is not as good evidence of what somebody sounds like as
    // a five-second one, and a flat average quietly makes the short ones louder.
    const state = play(
      add(),
      final('turn-1'),
      embedding('turn-1', axis(0), 4000),
      attribute('turn-1', 'speaker-1'),
      final('turn-2'),
      embedding('turn-2', axis(1), 500),
      attribute('turn-2', 'speaker-1'),
    );

    const centroid = buildCentroids(state.speakers, state.attributions, state.embeddings).get(
      'speaker-1',
    )!;
    expect(centroid[0]).toBeGreaterThan(centroid[1]!);
  });

  it('ignores a speaker who has been removed from the roster', () => {
    const centroids = buildCentroids(
      [],
      { 'turn-1': { speakerId: 'speaker-1', origin: 'confirmed' } },
      { 'turn-1': { vector: axis(0), audioMs: 2000 } },
    );

    expect(centroids.size).toBe(0);
  });
});

describe('suggesting a speaker', () => {
  // Three tests stood here and were removed on 2026-09-01, not fixed. They
  // asserted that the REDUCER runs this module — that a finished turn's vector
  // is scored against profiles built from confirmed turns. The reducer now runs
  // `auto-attribution.ts` instead, which discovers voices without anybody
  // confirming anything, so those tests described a wiring that no longer
  // exists. The reducer's behaviour is covered in `auto-attribution.spec.ts`.
  //
  // The functions below are still exported and still tested here, because they
  // are still correct and a caller may still want enrolment. What changed is
  // who calls them, and nothing in this file may keep claiming the reducer does.

  it('has a threshold that a near-miss falls under', () => {
    const centroids = new Map([['speaker-1', Float64Array.from(axis(0))]]);
    const nearMiss = between(0, 1, 0.75);

    expect(suggestSpeaker(centroids, axis(0))?.speakerId).toBe('speaker-1');
    expect(suggestSpeaker(centroids, nearMiss)).toBeNull();
    expect(TAU_SUGGEST).toBe(0.35);
  });

  it('never overrules somebody who already said', () => {
    const state = [
      final('turn-3'),
      attribute('turn-3', 'speaker-1'),
      embedding('turn-3', axis(1)),
    ].reduce(turnKeyedTranscriptReducer, twoKnownVoices());

    expect(attributionFor(state.attributions, 'turn-3')).toEqual({
      speakerId: 'speaker-1',
      origin: 'confirmed',
    });
  });

  it('keeps the vector even when it says nothing', () => {
    // The turn may be confirmed later, and then it is evidence.
    const state = [final('turn-3'), embedding('turn-3', axis(3))].reduce(
      turnKeyedTranscriptReducer,
      twoKnownVoices(),
    );

    expect(state.embeddings['turn-3']?.vector).toEqual(axis(3));
  });

  it('ignores a vector of the wrong width rather than scoring it', () => {
    const centroids = new Map([['speaker-1', Float64Array.from(axis(0))]]);

    expect(suggestSpeaker(centroids, [1, 0])).toBeNull();
  });
});

describe('resetting', () => {
  it('drops the voices with everything else', () => {
    const state = turnKeyedTranscriptReducer(twoKnownVoices(), { type: 'transcript.reset' });

    expect(state.embeddings).toEqual({});
    expect(state).toEqual(initialTurnKeyedTranscript);
  });
});
