/**
 * Tests for naming voices nobody enrolled.
 *
 * Two halves, because two things can break independently. The clusterer is a
 * pure function and its failures are arithmetic: a bar read the wrong way round,
 * a cap that blocks the wrong branch, a centroid that stops moving. The reducer
 * around it fails differently — it can place a turn correctly and still lose it,
 * overwrite something a person said, or end a conversation with a chip that
 * never resolved.
 *
 * The second half is where the design's promises live, so it is where the tests
 * are pointed: **every turn ends the session carrying an ordinal**, and **a name
 * already on screen never changes by itself**.
 */

import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@chatofy/types';

import {
  DEFAULT_AUTO_ATTRIBUTION,
  EMPTY_AUTO_ATTRIBUTION,
  isUsableConfig,
  observeVoice,
} from './auto-attribution.js';
import { attributionFor, MAX_SPEAKERS } from './speaker-roster.js';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';

/** A unit vector along one axis, so cosines between distinct axes are 0. */
const axis = (index: number, width = 4): number[] =>
  Array.from({ length: width }, (_, at) => (at === index ? 1 : 0));

/**
 * A unit vector whose cosine to `axis(0)` and `axis(1)` is exactly what is asked
 * for, with whatever is left over parked on an axis nothing else uses.
 *
 * Stating the cosines directly rather than mixing two axes and hoping: the bars
 * under test are 0.325 and 0.375 apart, and a helper that lands a tenth away
 * tests the wrong branch while still looking like it tested the right one.
 */
const cosines = (toFirst: number, toSecond: number): number[] => {
  const remainder = 1 - toFirst * toFirst - toSecond * toSecond;
  if (remainder < 0)
    throw new Error(`${toFirst},${toSecond} cannot both be cosines of a unit vector`);
  return [toFirst, toSecond, Math.sqrt(remainder), 0];
};

/** Between both bars, so the clusterer must hold the turn rather than place it. */
const DEAD_ZONE = cosines(0.35, 0.3);
/** Same, but leaning at the second voice — so the settle pass has a right answer. */
const DEAD_ZONE_TOWARD_SECOND = cosines(0.3, 0.35);
/** Under `tauNew` against both, so it would mint a speaker if the cap allowed one. */
const STRANGER = cosines(0.2, 0.3);

const segment = (sessionId: string) => ({
  id: sessionId,
  sessionId,
  speakerRole: 'speaker_a' as const,
  direction: 'vi_to_en' as const,
  sourceText: 'xin chào',
  targetText: 'hello',
  audioUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const final = (sessionId: string): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: segment(sessionId),
});

const embedding = (sessionId: string, vector: number[], audioMs = 1000): ServerEvent => ({
  type: 'server.turn.embedding',
  sessionId,
  vector,
  dim: vector.length,
  audioMs,
});

const settled = (): TurnKeyedAction => ({ type: 'transcript.settled' });

/**
 * Continue an existing conversation.
 *
 * A typed rest parameter rather than an inline array literal fed to `reduce`:
 * an untyped literal widens `type` to `string`, `reduce` then picks the
 * element-typed overload, and the file stops typechecking while vitest — which
 * transpiles without checking — keeps reporting the suite green.
 */
const from = (start: TurnKeyedTranscript, ...actions: TurnKeyedAction[]): TurnKeyedTranscript =>
  actions.reduce(turnKeyedTranscriptReducer, start);

const play = (...actions: TurnKeyedAction[]): TurnKeyedTranscript =>
  from(initialTurnKeyedTranscript, ...actions);

/** One turn each from two clearly different voices, auto-attributed. */
const twoVoices = () =>
  play(
    final('turn-1'),
    embedding('turn-1', axis(0)),
    final('turn-2'),
    embedding('turn-2', axis(1)),
  );

// --- the clusterer -------------------------------------------------------

describe('placing a voice', () => {
  it('mints the first speaker from the first turn, with nothing to compare against', () => {
    const { state, assignment } = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));

    expect(assignment).toMatchObject({ index: 0, created: true });
    expect(state.clusters).toHaveLength(1);
  });

  it('joins a voice it has heard before rather than minting a second one', () => {
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));
    const second = observeVoice(first.state, axis(0));

    expect(second.assignment).toMatchObject({ index: 0, created: false });
    expect(second.state.clusters).toHaveLength(1);
    // Folded in, not discarded: the profile has to keep moving or a voice that
    // drifts through a conversation is eventually unrecognisable to itself.
    expect(second.state.clusters[0]!.turns).toBe(2);
  });

  it('mints a second speaker for a voice that is far from the first', () => {
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));
    const second = observeVoice(first.state, axis(1));

    expect(second.assignment).toMatchObject({ index: 1, created: true });
  });

  it('places nothing in the dead zone, and still says which voice was nearest', () => {
    // Between the two bars: not close enough to join, not far enough to be new.
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));
    const { assignment } = observeVoice(first.state, cosines(0.35, 0));

    expect(assignment.score).toBeGreaterThan(DEFAULT_AUTO_ATTRIBUTION.tauNew);
    expect(assignment.score).toBeLessThan(DEFAULT_AUTO_ATTRIBUTION.tauAssign);
    expect(assignment.index).toBeNull();
    // The whole reason the field exists: a turn the bars refused still has a
    // best guess, and the settle pass is what spends it.
    expect(assignment.nearest).toBe(0);
  });

  it('leaves the state untouched when it places nothing', () => {
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));
    const second = observeVoice(first.state, cosines(0.35, 0));

    // A dead-zone turn must not move a centroid. Folding it in would let the
    // profile drift toward exactly the voices the bar refused to accept.
    expect(second.state).toBe(first.state);
  });

  it('assigns a third voice to its nearest neighbour rather than minting past the cap', () => {
    const state = [axis(0), axis(1)].reduce(
      (carried, vector) => observeVoice(carried, vector).state,
      EMPTY_AUTO_ATTRIBUTION,
    );
    // Nearer to voice 1 than to voice 0, and far enough from both to have been
    // a new speaker if the cap allowed one.
    const { assignment, state: next } = observeVoice(state, STRANGER);

    expect(next.clusters).toHaveLength(DEFAULT_AUTO_ATTRIBUTION.kMax);
    expect(assignment.created).toBe(false);
    expect(assignment.index).toBe(1);
  });

  it('joins at exactly tauAssign, and holds one hair below it', () => {
    // The bar is `>=`. Nothing else in this file sits on it, so relaxing it to
    // `>` would leave every other test green — the mutation this exists to kill.
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));

    expect(
      observeVoice(first.state, cosines(DEFAULT_AUTO_ATTRIBUTION.tauAssign, 0)).assignment.index,
    ).toBe(0);
    expect(
      observeVoice(first.state, cosines(DEFAULT_AUTO_ATTRIBUTION.tauAssign - 1e-6, 0)).assignment
        .index,
    ).toBeNull();
  });

  it('mints at exactly one hair below tauNew, and holds on the bar itself', () => {
    // The other bar is `<`, so a turn sitting exactly on `tauNew` is in the dead
    // zone, not a new speaker. Relaxing it to `<=` moves that turn from held to
    // minted, which is a speaker appearing out of a rounding difference.
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0));

    expect(
      observeVoice(first.state, cosines(DEFAULT_AUTO_ATTRIBUTION.tauNew, 0)).assignment.index,
    ).toBeNull();
    expect(
      observeVoice(first.state, cosines(DEFAULT_AUTO_ATTRIBUTION.tauNew - 1e-6, 0)).assignment,
    ).toMatchObject({ index: 1, created: true });
  });

  it('still lets a known voice join once the cap is full', () => {
    // The asymmetry the cap is built around: it blocks creation, never joining.
    const state = [axis(0), axis(1)].reduce(
      (carried, vector) => observeVoice(carried, vector).state,
      EMPTY_AUTO_ATTRIBUTION,
    );
    const { assignment } = observeVoice(state, axis(0));

    expect(assignment).toMatchObject({ index: 0, created: false });
  });

  it('refuses an inverted dead zone rather than minting a speaker per turn', () => {
    const inverted = { tauAssign: 0.3, tauNew: 0.6, kMax: 2 };

    expect(isUsableConfig(inverted)).toBe(false);
    // Places nothing instead of throwing: a misconfiguration must not take the
    // conversation down, and "everything pending" is a state the rest handles.
    expect(observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0), inverted).assignment.index).toBeNull();
  });

  it('ignores a vector of the wrong width rather than scoring it', () => {
    const first = observeVoice(EMPTY_AUTO_ATTRIBUTION, axis(0, 4));
    const { assignment } = observeVoice(first.state, axis(0, 8));

    expect(assignment.index).toBeNull();
  });
});

// --- the reducer around it -----------------------------------------------

describe('labelling a conversation nobody tapped', () => {
  it('names two speakers without a single tap', () => {
    const state = twoVoices();

    expect(state.speakers).toHaveLength(2);
    expect(attributionFor(state.attributions, 'turn-1')).toMatchObject({
      speakerId: state.speakers[0]!.id,
      origin: 'suggested',
    });
    expect(attributionFor(state.attributions, 'turn-2')).toMatchObject({
      speakerId: state.speakers[1]!.id,
      origin: 'suggested',
    });
  });

  it('gives a returning voice the ordinal it had the first time', () => {
    const state = from(twoVoices(), final('turn-3'), embedding('turn-3', axis(0)));

    expect(attributionFor(state.attributions, 'turn-3').speakerId).toBe(state.speakers[0]!.id);
    expect(state.speakers).toHaveLength(2);
  });

  it('holds a turn it cannot place, rather than guessing or dropping it', () => {
    const state = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE));

    expect(attributionFor(state.attributions, 'turn-3')).toEqual({
      speakerId: null,
      origin: 'pending',
    });
  });

  it('keeps the vector of a turn it could not place', () => {
    // Without it the settle pass has nothing to spend, and the promise `pending`
    // makes could not be kept.
    const state = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE));

    expect(state.embeddings['turn-3']).toBeDefined();
  });
});

describe('when the roster cannot hold another name', () => {
  it('holds the turn instead of minting a voice nothing can point at', () => {
    // `addSpeaker` refuses past MAX_SPEAKERS. If the clusterer's new state were
    // committed anyway, a cluster would exist with no roster id behind it — and
    // because the id lookup is positional, every later voice would read the
    // wrong id or none. The session would wedge with every chip unresolved.
    const full = play(
      ...Array.from({ length: MAX_SPEAKERS }, () => ({ type: 'transcript.speakerAdded' }) as const),
    );
    const state = from(full, final('turn-1'), embedding('turn-1', axis(0)));

    expect(state.speakers).toHaveLength(MAX_SPEAKERS);
    expect(attributionFor(state.attributions, 'turn-1').origin).toBe('pending');
    // The cluster was NOT minted, so the roster and the voices stay in lockstep.
    expect(state.autoAttribution.clusters).toHaveLength(state.autoSpeakerIds.length);
  });

  it('holds a turn whose discovered speaker was removed from the roster', () => {
    // Two taps get here: unattribute the turn, then remove the speaker it named.
    // Attributing to somebody off the roster renders as nothing at all, and does
    // it with no error to notice — so the turn waits instead.
    const one = play(final('turn-1'), embedding('turn-1', axis(0)));
    const removed = from(
      one,
      { type: 'transcript.turnUnattributed', sessionId: 'turn-1' },
      { type: 'transcript.speakerRemoved', speakerId: one.speakers[0]!.id },
    );
    expect(removed.speakers).toHaveLength(0);

    const state = from(removed, final('turn-2'), embedding('turn-2', axis(0)));

    expect(attributionFor(state.attributions, 'turn-2').origin).toBe('pending');
  });
});

describe('a name already on screen', () => {
  it('is never changed by a later, better-informed turn', () => {
    const first = twoVoices();
    const firstSpeaker = attributionFor(first.attributions, 'turn-1').speakerId;
    // Same turn, a vector that would now place it with the other voice.
    const state = turnKeyedTranscriptReducer(first, embedding('turn-1', axis(1)));

    expect(attributionFor(state.attributions, 'turn-1').speakerId).toBe(firstSpeaker);
  });

  it('is never overruled when a person put it there', () => {
    const confirmed = play(final('turn-1'), embedding('turn-1', axis(0)), {
      type: 'transcript.turnAttributed',
      sessionId: 'turn-1',
      speakerId: 'speaker-1',
    });
    const state = turnKeyedTranscriptReducer(confirmed, embedding('turn-1', axis(1)));

    expect(attributionFor(state.attributions, 'turn-1')).toMatchObject({
      speakerId: 'speaker-1',
      origin: 'confirmed',
    });
  });

  it('can still be changed by a person, including one that is pending', () => {
    const pending = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE));
    expect(attributionFor(pending.attributions, 'turn-3').origin).toBe('pending');

    const state = turnKeyedTranscriptReducer(pending, {
      type: 'transcript.turnAttributed',
      sessionId: 'turn-3',
      speakerId: pending.speakers[0]!.id,
    });

    expect(attributionFor(state.attributions, 'turn-3')).toMatchObject({
      speakerId: pending.speakers[0]!.id,
      origin: 'confirmed',
    });
  });
});

describe('hearing the same turn twice', () => {
  it('folds it into a voice only once', () => {
    // A re-delivered embedding must not fold the same turn twice. The reference
    // implementation observes each turn once, and a doubled fold moves the
    // profile the NEXT turn is compared against while changing nothing visible.
    const state = from(
      play(final('turn-1'), embedding('turn-1', axis(0))),
      embedding('turn-1', axis(0)),
    );

    expect(state.autoAttribution.clusters[0]!.turns).toBe(1);
  });
});

describe('settling up when the conversation ends', () => {
  it('leaves no turn without an ordinal', () => {
    const state = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE), settled());

    for (const turn of state.turns) {
      const attribution = attributionFor(state.attributions, turn.sessionId);
      expect(attribution.origin).not.toBe('pending');
      expect(attribution.speakerId).not.toBeNull();
    }
  });

  it('fills a held turn with the voice its own vector was nearest to', () => {
    const state = from(
      twoVoices(),
      final('turn-3'),
      embedding('turn-3', DEAD_ZONE_TOWARD_SECOND),
      settled(),
    );

    expect(attributionFor(state.attributions, 'turn-3').speakerId).toBe(state.speakers[1]!.id);
  });

  it('carries an ordinal forward to a turn whose vector never arrived', () => {
    // The last one to three turns of EVERY session: the socket closes before the
    // server can emit their embedding, so there is no evidence to spend at all.
    // They never reach `pending`, because the acoustic layer never heard them —
    // which is exactly why settling has to walk the transcript rather than the
    // pending set. An earlier version of this test asserted these stay
    // `fallback`, under this same title. It was the violation, written down as
    // the expectation.
    const state = from(
      twoVoices(),
      final('turn-3'),
      embedding('turn-3', DEAD_ZONE),
      final('turn-4'),
      final('turn-5'),
      settled(),
    );

    const third = attributionFor(state.attributions, 'turn-3').speakerId;
    expect(third).not.toBeNull();
    expect(attributionFor(state.attributions, 'turn-4').speakerId).toBe(third);
    // And it keeps carrying: a run of unheard turns all inherit from the last
    // turn that had evidence, rather than only the first of them.
    expect(attributionFor(state.attributions, 'turn-5').speakerId).toBe(third);
  });

  it('settles as a suggestion, never as something a person said', () => {
    // A settle pass that wrote `confirmed` would forge human authority: the
    // turn would then be immune to correction by the very rules that exist to
    // protect a person's choice, and it would count as a tap in the statistics.
    const state = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE), settled());

    expect(attributionFor(state.attributions, 'turn-3').origin).toBe('suggested');
  });

  it('leaves a turn a person rejected alone', () => {
    // `unattributeTurn` records "nobody here said this" as `fallback` carrying
    // the rejected suggestion. It is not rendered, so a settle pass that only
    // asked about rendering would re-apply the label just thrown away — and
    // would destroy the strongest evidence this design collects about whether
    // the acoustic layer works at all.
    const state = from(
      twoVoices(),
      final('turn-3'),
      embedding('turn-3', DEAD_ZONE_TOWARD_SECOND),
      { type: 'transcript.turnUnattributed', sessionId: 'turn-3' },
      settled(),
    );

    expect(attributionFor(state.attributions, 'turn-3')).toMatchObject({
      speakerId: null,
      origin: 'fallback',
    });
  });

  it('does not touch what a person said', () => {
    const confirmed = from(
      twoVoices(),
      final('turn-3'),
      embedding('turn-3', DEAD_ZONE),
      { type: 'transcript.turnAttributed', sessionId: 'turn-3', speakerId: 'speaker-1' },
      settled(),
    );

    expect(attributionFor(confirmed.attributions, 'turn-3')).toMatchObject({
      speakerId: 'speaker-1',
      origin: 'confirmed',
    });
  });

  it('changes nothing on a second pass', () => {
    const once = from(twoVoices(), final('turn-3'), embedding('turn-3', DEAD_ZONE), settled());
    const twice = turnKeyedTranscriptReducer(once, settled());

    expect(twice.attributions).toEqual(once.attributions);
  });
});

describe('resetting', () => {
  it('drops the discovered voices with everything else', () => {
    const state = turnKeyedTranscriptReducer(twoVoices(), { type: 'transcript.reset' });

    expect(state.autoAttribution.clusters).toHaveLength(0);
    expect(state.autoSpeakerIds).toHaveLength(0);
    expect(state.speakers).toHaveLength(0);
  });
});
