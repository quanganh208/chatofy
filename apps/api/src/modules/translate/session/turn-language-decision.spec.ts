import type { LanguageCode } from '@chatofy/types';
import { describe, expect, it } from 'vitest';
import {
  SourcePrior,
  TurnLanguageDecision,
  type LanguageMode,
} from './turn-language-decision';
import { planTurnLanguages } from './turn-language-plan';

const conversation: LanguageCode[] = ['vi', 'en'];
const planFor = (language: LanguageCode) =>
  planTurnLanguages(conversation, [language]);

function decision(mode: LanguageMode = 'two-way') {
  return new TurnLanguageDecision(
    mode,
    mode === 'declared' ? ['vi'] : ['vi', 'en'],
    'vi',
    planFor,
  );
}

const none = { previous: null, source: 'vi' as LanguageCode };

describe('TurnLanguageDecision', () => {
  it('keeps a declared pair on its declared language for every turn', () => {
    const turn = decision('declared');

    expect(turn.identifying).toBe(false);
    expect(turn.locked).toBe('vi');
    expect(
      turn.observe(
        { language: 'en', confidence: 1, speechMs: 5000 },
        new SourcePrior('vi'),
        100,
      ),
    ).toBe(false);
    expect(
      turn.decideFinal(
        { language: 'en', confidence: 1 },
        new SourcePrior('vi'),
        none,
      ),
    ).toBe('vi');
    expect(turn.plan.recognition).toBe('vi');
    expect(turn.via).toBe('declared');
    expect(turn.overridden).toBe(false);
  });

  it("locks a two-way turn's live preview once confidence and speech length reach the lock bar", () => {
    const turn = decision();
    const prior = new SourcePrior('vi');

    // Confident but too short: held.
    expect(
      turn.observe(
        { language: 'en', confidence: 0.95, speechMs: 900 },
        prior,
        900,
      ),
    ).toBe(false);
    expect(turn.locked).toBeNull();
    // Long enough but unsure: held.
    expect(
      turn.observe(
        { language: 'en', confidence: 0.55, speechMs: 1600 },
        prior,
        1200,
      ),
    ).toBe(false);
    expect(turn.locked).toBeNull();
    expect(
      turn.observe(
        { language: 'en', confidence: 0.6, speechMs: 1500 },
        prior,
        1500,
      ),
    ).toBe(true);
    expect(turn.locked).toBe('en');
    expect(turn.lockedAtMs).toBe(1500);
    expect(turn.plan.recognition).toBe('en');
    expect(turn.plan.targets).toEqual(['vi']);
    // One lock per turn.
    expect(
      turn.observe(
        { language: 'vi', confidence: 1, speechMs: 3000 },
        prior,
        2000,
      ),
    ).toBe(false);
    expect(turn.locked).toBe('en');
  });

  it('counts the times consecutive partials heard different languages', () => {
    const turn = decision();
    const prior = new SourcePrior('vi');
    for (const language of ['vi', 'en', 'en', 'vi'] as const) {
      turn.observe({ language, confidence: 0.5, speechMs: 600 }, prior, 0);
    }
    expect(turn.switches).toBe(2);
  });

  it('re-decides the final on the whole turn and corrects a wrong lock', () => {
    const turn = decision();
    const prior = new SourcePrior('vi');
    turn.observe(
      { language: 'en', confidence: 0.7, speechMs: 1800 },
      prior,
      1800,
    );

    expect(
      turn.decideFinal({ language: 'vi', confidence: 0.97 }, prior, none),
    ).toBe('vi');
    expect(turn.overridden).toBe(true);
    expect(turn.plan.recognition).toBe('vi');
    expect(turn.via).toBe('model');
  });

  it("takes the previous turn's language from the turn opened before it when the final is unsure", () => {
    const turn = decision();

    expect(
      turn.decideFinal(
        { language: 'vi', confidence: 0.52 },
        new SourcePrior('vi'),
        {
          previous: 'en',
          source: 'vi',
        },
      ),
    ).toBe('en');
    expect(turn.via).toBe('previous');
  });

  it('biases an uncertain single-speaker turn toward the source', () => {
    const turn = decision();

    expect(
      turn.decideFinal(
        { language: 'en', confidence: 0.55 },
        new SourcePrior('vi'),
        none,
      ),
    ).toBe('vi');
    expect(turn.via).toBe('source');
  });

  it('treats a sidecar that could not identify as unsure', () => {
    const turn = decision();

    expect(
      turn.decideFinal(
        { language: 'en', confidence: null },
        new SourcePrior('vi'),
        none,
      ),
    ).toBe('vi');
    // A language outside the candidates is a sidecar that ignored them.
    const other = decision();
    expect(
      other.decideFinal(
        { language: 'zh', confidence: 0.99 },
        new SourcePrior('vi'),
        none,
      ),
    ).toBe('vi');
  });

  it('keeps what a detect turn heard when it has nothing to fall back on', () => {
    const turn = new TurnLanguageDecision(
      'detect',
      ['vi', 'en'],
      'en',
      planFor,
    );

    expect(
      turn.decideFinal(
        { language: 'vi', confidence: 0.5 },
        new SourcePrior(null),
        {
          previous: null,
          source: null,
        },
      ),
    ).toBe('vi');
  });
});

describe('SourcePrior', () => {
  it('leans a pair towards the source until a confident turn in the other language', () => {
    const prior = new SourcePrior('vi', Math.log(3));

    // p=0.5 for en with a 3:1 bonus on vi → 0.25.
    expect(prior.confidence({ language: 'en', confidence: 0.5 })).toBeCloseTo(
      0.25,
    );
    expect(prior.confidence({ language: 'vi', confidence: 0.5 })).toBeCloseTo(
      0.75,
    );
    prior.observe({ language: 'en', confidence: 0.95 });
    expect(prior.confidence({ language: 'en', confidence: 0.5 })).toBe(0.5);
  });

  it('is a no-op at the shipped zero bonus', () => {
    expect(
      new SourcePrior('vi').confidence({ language: 'en', confidence: 0.55 }),
    ).toBe(0.55);
  });
});
