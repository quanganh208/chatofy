import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';
import {
  attributionFor,
  canRemoveSpeaker,
  speakerFor,
  MAX_SPEAKERS,
  UNATTRIBUTED,
} from './speaker-roster.js';

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

const add = (label?: string): TurnKeyedAction => ({ type: 'transcript.speakerAdded', label });

const attribute = (sessionId: string, speakerId: string): TurnKeyedAction => ({
  type: 'transcript.turnAttributed',
  sessionId,
  speakerId,
});

/** Fold a conversation the way the socket and the UI would interleave it. */
const play = (...actions: TurnKeyedAction[]): TurnKeyedTranscript =>
  actions.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

describe('the roster', () => {
  it('names participants for them until they say otherwise', () => {
    const state = play(add(), add());

    expect(state.speakers).toEqual([
      { id: 'speaker-1', label: 'Speaker 1' },
      { id: 'speaker-2', label: 'Speaker 2' },
    ]);
  });

  it('takes a name when one is offered', () => {
    expect(play(add('An')).speakers[0]?.label).toBe('An');
  });

  it('ignores a blank name rather than storing one', () => {
    const state = play(add('An'), {
      type: 'transcript.speakerRenamed',
      speakerId: 'speaker-1',
      label: '   ',
    });

    expect(state.speakers[0]?.label).toBe('An');
  });

  it('refuses a participant past the cap', () => {
    const state = play(...Array.from({ length: MAX_SPEAKERS + 1 }, () => add()));

    expect(state.speakers).toHaveLength(MAX_SPEAKERS);
    expect(state.speakers.at(-1)?.id).toBe(`speaker-${MAX_SPEAKERS}`);
  });

  it('does not reuse the id of a removed participant', () => {
    // The collision this guards: with ids derived from the roster's length,
    // removing the second of two and adding another would mint `speaker-2`
    // again, and the roster would hold two people the reducer cannot tell apart.
    const state = play(
      add(),
      add(),
      { type: 'transcript.speakerRemoved', speakerId: 'speaker-2' },
      add(),
    );

    expect(state.speakers.map((speaker) => speaker.id)).toEqual(['speaker-1', 'speaker-3']);
  });
});

describe('removing a participant', () => {
  it('is allowed while they have said nothing', () => {
    const state = play(add(), { type: 'transcript.speakerRemoved', speakerId: 'speaker-1' });

    expect(state.speakers).toEqual([]);
  });

  it('is refused once a turn names them', () => {
    // The alternative — dropping their attributions — would leave the transcript
    // claiming nobody said turns somebody said. A stale name is the smaller wrong.
    const state = play(add(), final('turn-1'), attribute('turn-1', 'speaker-1'), {
      type: 'transcript.speakerRemoved',
      speakerId: 'speaker-1',
    });

    expect(state.speakers).toHaveLength(1);
    expect(attributionFor(state.attributions, 'turn-1').speakerId).toBe('speaker-1');
  });

  it('leaves no attribution pointing at nobody', () => {
    const state = play(add(), add(), final('turn-1'), attribute('turn-1', 'speaker-2'), {
      type: 'transcript.speakerRemoved',
      speakerId: 'speaker-2',
    });

    for (const attribution of Object.values(state.attributions)) {
      if (!attribution.speakerId) continue;
      expect(state.speakers.some((speaker) => speaker.id === attribution.speakerId)).toBe(true);
    }
    expect(canRemoveSpeaker(state.attributions, 'speaker-2')).toBe(false);
  });
});

describe('attributing a turn', () => {
  it('reads as unattributed until somebody says', () => {
    const state = play(add(), final('turn-1'));

    expect(attributionFor(state.attributions, 'turn-1')).toEqual(UNATTRIBUTED);
    expect(speakerFor(state.speakers, state.attributions, 'turn-1')).toBeNull();
  });

  it('records a person choosing as confirmed, never as a suggestion', () => {
    const state = play(add(), final('turn-1'), attribute('turn-1', 'speaker-1'));

    expect(attributionFor(state.attributions, 'turn-1')).toEqual({
      speakerId: 'speaker-1',
      origin: 'confirmed',
    });
  });

  it('overwrites on re-attribution rather than keeping both', () => {
    const state = play(
      add(),
      add(),
      final('turn-1'),
      attribute('turn-1', 'speaker-1'),
      attribute('turn-1', 'speaker-2'),
    );

    expect(Object.keys(state.attributions)).toEqual(['turn-1']);
    expect(attributionFor(state.attributions, 'turn-1').speakerId).toBe('speaker-2');
  });

  it('refuses a speaker who is not on the roster', () => {
    // An attribution pointing at nobody renders as nothing and reports nothing.
    const state = play(final('turn-1'), attribute('turn-1', 'speaker-9'));

    expect(state.attributions).toEqual({});
  });

  it('stays on its own turn while other turns arrive around it', () => {
    // The defect class the package comment says has shipped twice: a correction
    // made while later turns are in flight landing on the wrong one. Keyed by
    // sessionId, never by position, so the interleaving cannot move it.
    const state = play(
      add(),
      add(),
      final('turn-1'),
      partial('turn-2', 'đang nói'),
      final('turn-2'),
      attribute('turn-1', 'speaker-1'),
      partial('turn-3', 'nói tiếp'),
      final('turn-3'),
      attribute('turn-3', 'speaker-2'),
    );

    expect(attributionFor(state.attributions, 'turn-1').speakerId).toBe('speaker-1');
    expect(attributionFor(state.attributions, 'turn-2')).toEqual(UNATTRIBUTED);
    expect(attributionFor(state.attributions, 'turn-3').speakerId).toBe('speaker-2');
  });

  it('survives turns that arrive after it', () => {
    const state = play(
      add(),
      final('turn-1'),
      attribute('turn-1', 'speaker-1'),
      final('turn-2'),
      final('turn-3'),
    );

    expect(attributionFor(state.attributions, 'turn-1').speakerId).toBe('speaker-1');
    expect(state.turns).toHaveLength(3);
  });
});

describe('resetting the conversation', () => {
  it('drops the roster and the attributions together', () => {
    // They are one subject: a roster surviving the transcript it labels would be
    // names for turns that no longer exist. This is also the whole of the
    // no-persistence guarantee — there is nowhere else the labels live.
    const state = play(add('An'), final('turn-1'), attribute('turn-1', 'speaker-1'), {
      type: 'transcript.reset',
    });

    expect(state).toEqual(initialTurnKeyedTranscript);
    expect(state.speakers).toEqual([]);
    expect(state.attributions).toEqual({});
    expect(state.nextSpeakerNumber).toBe(1);
  });
});

describe('speakerFor', () => {
  it('resolves an attribution to the participant it names', () => {
    const state = play(add('An'), final('turn-1'), attribute('turn-1', 'speaker-1'));

    expect(speakerFor(state.speakers, state.attributions, 'turn-1')).toEqual({
      id: 'speaker-1',
      label: 'An',
    });
  });
});

describe('putting a turn back to unattributed', () => {
  it('frees the speaker it named for removal', () => {
    // The dead end this exists to prevent: with only one person on the roster,
    // a mistaken attribution could neither be cleared nor removed, because
    // removal is refused for a speaker who has turns.
    const attributed = play(add(), final('turn-1'), attribute('turn-1', 'speaker-1'));
    expect(canRemoveSpeaker(attributed.attributions, 'speaker-1')).toBe(false);

    const cleared = [
      { type: 'transcript.turnUnattributed', sessionId: 'turn-1' } as TurnKeyedAction,
      { type: 'transcript.speakerRemoved', speakerId: 'speaker-1' } as TurnKeyedAction,
    ].reduce(turnKeyedTranscriptReducer, attributed);

    expect(cleared.speakers).toEqual([]);
    expect(attributionFor(cleared.attributions, 'turn-1')).toEqual(UNATTRIBUTED);
  });

  it('records the refusal even when the turn had no row yet', () => {
    // This spec used to assert the opposite — that the attributions map stayed
    // empty — and that assertion was the bug, pinned. A turn only gets a row
    // when its vector arrives, and the vector arrives AFTER the final
    // transcript, so every turn is tappable for a round trip before it has one.
    // Dropping the refusal there let the vector land on a turn with nothing
    // recorded, and the clusterer then named somebody the person had just said
    // did not speak.
    const state = play(add(), final('turn-1'), {
      type: 'transcript.turnUnattributed',
      sessionId: 'turn-1',
    });

    expect(state.attributions['turn-1']).toEqual({ speakerId: null, origin: 'fallback' });
  });

  it('touches only the turn it names', () => {
    const state = play(
      add(),
      final('turn-1'),
      final('turn-2'),
      attribute('turn-1', 'speaker-1'),
      attribute('turn-2', 'speaker-1'),
      { type: 'transcript.turnUnattributed', sessionId: 'turn-1' },
    );

    expect(attributionFor(state.attributions, 'turn-1')).toEqual(UNATTRIBUTED);
    expect(attributionFor(state.attributions, 'turn-2').speakerId).toBe('speaker-1');
  });
});

describe('editing the roster mid-conversation', () => {
  it('leaves the turns and the live lines exactly as they were', () => {
    // The panel that owns this state releases the microphone and the socket in
    // its unmount cleanup, so anything that disturbed the conversation while
    // somebody added a person would read to them as the app having stopped
    // listening. Nothing about a roster edit may touch what is being said.
    const talking = play(add(), final('turn-1'), partial('turn-2', 'đang nói'));

    const edited = [
      add('An'),
      {
        type: 'transcript.speakerRenamed',
        speakerId: 'speaker-1',
        label: 'Bình',
      } as TurnKeyedAction,
      attribute('turn-1', 'speaker-1'),
    ].reduce(turnKeyedTranscriptReducer, talking);

    expect(edited.turns).toEqual(talking.turns);
    expect(edited.live).toEqual(talking.live);
  });
});
