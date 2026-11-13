// The settings model's pure rules: the speed and text-size grids, which pairs a page
// can show and run, the stage, and what a start sends. How a stored document becomes
// these settings is `translate-settings-preferences.spec.ts`.
import { describe, expect, it } from 'vitest';
import { en, vi as viMessages } from '@chatofy/i18n';
import { DEFAULT_LANGUAGE_PAIR } from '@chatofy/types';
import {
  DEFAULT_LANGUAGE_VOICE,
  DEFAULT_STAGE_APPEARANCE,
  DEFAULT_TRANSLATE_SETTINGS,
  SPEED_PRESETS,
  TEXT_SIZE_SCALES,
  asksTwoWay,
  canAutoDetectInto,
  effectiveStageAppearance,
  languageVoicePatch,
  pairFor,
  pairPatchFor,
  representablePair,
  sessionVoiceOptions,
  spokenLanguagesOf,
  textSizeScale,
} from './translate-settings';

describe('the speed presets', () => {
  it('stay inside the range the wire clamps to', () => {
    // `translateRequestSchema` and `sessionOptionsSchema` both pull the value
    // into [0.5, 2], and the local sidecar 422s outside it. A preset outside
    // that range would be a button whose value silently becomes another one.
    for (const preset of SPEED_PRESETS) {
      expect(preset).toBeGreaterThanOrEqual(0.5);
      expect(preset).toBeLessThanOrEqual(2);
    }
  });

  it('can name a turn it dropped, wherever it offers a rate below 1×', () => {
    // Slower speech outlasts the cadence turns arrive at, so under continuous
    // speech the backlog grows and OrderedPlayback drops whole turns. The
    // presets stay; what has to stay with them is a way to SAY a turn was lost.
    //
    // This used to assert a warning printed under the control before anything
    // had gone wrong. That paragraph is gone: the per-turn marker below reports
    // the loss on the row it happened to, which is the disclosure that matters.
    expect(SPEED_PRESETS.some((preset) => preset < 1)).toBe(true);
    // Aliased on import: `vi` here is vitest's own.
    expect(en['web.translate.turnUnheard']).toBeTruthy();
    expect(viMessages['web.translate.turnUnheard']).toBeTruthy();
  });
});

describe('the reading scale', () => {
  it('is neutral at the default step', () => {
    // The step the transcript has always been. If this stops being 1 the whole
    // screen silently re-typesets for everyone who never touched the control.
    expect(textSizeScale(DEFAULT_TRANSLATE_SETTINGS.textSize)).toBe(1);
  });

  it('rises with the step, and never flips the two lines', () => {
    // One multiplier for both reading lines is what keeps the translation the
    // larger of the two at every step — a per-size table could let them cross.
    for (let step = 2; step <= TEXT_SIZE_SCALES.length; step += 1) {
      expect(textSizeScale(step)).toBeGreaterThan(textSizeScale(step - 1));
    }
  });

  it('answers for a step that does not exist', () => {
    expect(textSizeScale(0)).toBe(textSizeScale(1));
    expect(textSizeScale(50)).toBe(textSizeScale(TEXT_SIZE_SCALES.length));
  });
});

describe('an auto-detected source', () => {
  it('is offered exactly where a turn in the translation language can be recognised', () => {
    expect(canAutoDetectInto('vi')).toBe(true);
    expect(canAutoDetectInto('en')).toBe(true);
    expect(canAutoDetectInto('zh')).toBe(false);
  });

  it('keeps every other pair untouched', () => {
    expect(representablePair({ source: 'detect', target: 'vi' })).toEqual({
      source: 'detect',
      target: 'vi',
    });
    expect(representablePair({ source: 'en', target: 'zh' })).toEqual({
      source: 'en',
      target: 'zh',
    });
  });
});

describe('asking for two-way', () => {
  it('asks only from the two-way page, for a pair whose languages can be told apart', () => {
    expect(asksTwoWay({ source: 'vi', target: 'en' }, 'two-way')).toBe(true);
    expect(asksTwoWay({ source: 'en', target: 'vi' }, 'two-way')).toBe(true);
    expect(asksTwoWay({ source: 'vi', target: 'zh' }, 'two-way')).toBe(false);
    expect(asksTwoWay({ source: 'detect', target: 'en' }, 'two-way')).toBe(false);
    expect(asksTwoWay({ source: 'vi', target: 'en' }, 'one-way')).toBe(false);
  });
});

describe('one pair per page', () => {
  it('defaults the two-way pair to the default pair', () => {
    expect(DEFAULT_TRANSLATE_SETTINGS.twoWayPair).toEqual(DEFAULT_LANGUAGE_PAIR);
  });

  it('keeps a pick on one page off the other', () => {
    const oneWay = {
      ...DEFAULT_TRANSLATE_SETTINGS,
      ...pairPatchFor('one-way', { source: 'detect', target: 'en' }),
    };
    expect(pairFor(oneWay, 'one-way')).toEqual({ source: 'detect', target: 'en' });
    expect(pairFor(oneWay, 'two-way')).toEqual(DEFAULT_TRANSLATE_SETTINGS.twoWayPair);

    const twoWay = {
      ...DEFAULT_TRANSLATE_SETTINGS,
      ...pairPatchFor('two-way', { source: 'en', target: 'vi' }),
    };
    expect(pairFor(twoWay, 'two-way')).toEqual({ source: 'en', target: 'vi' });
    expect(pairFor(twoWay, 'one-way')).toEqual(DEFAULT_TRANSLATE_SETTINGS.languagePair);
  });

  it('refuses a two-way pair that cannot run two-way', () => {
    expect(pairPatchFor('two-way', { source: 'detect', target: 'en' })).toEqual({});
    expect(pairPatchFor('two-way', { source: 'zh', target: 'vi' })).toEqual({});
  });
});

describe('the stage', () => {
  it('starts as captions: black ground, bold translation, larger text', () => {
    expect(DEFAULT_STAGE_APPEARANCE.background).toBe('black');
    expect(DEFAULT_STAGE_APPEARANCE.targetWeight).toBe('bold');
    expect(DEFAULT_STAGE_APPEARANCE.textSize).toBeGreaterThan(DEFAULT_TRANSLATE_SETTINGS.textSize);
    expect(DEFAULT_STAGE_APPEARANCE.followPage).toBe(false);
  });

  it('draws with its own values unless it follows the page', () => {
    const own = effectiveStageAppearance(DEFAULT_TRANSLATE_SETTINGS);
    expect(own.textSize).toBe(DEFAULT_STAGE_APPEARANCE.textSize);
    expect(own.appearance.background).toBe('black');
    expect(own.appearance).not.toHaveProperty('followPage');

    const following = effectiveStageAppearance({
      ...DEFAULT_TRANSLATE_SETTINGS,
      textSize: 2,
      stage: { ...DEFAULT_STAGE_APPEARANCE, followPage: true },
    });
    expect(following).toEqual({ appearance: DEFAULT_TRANSLATE_SETTINGS.appearance, textSize: 2 });
  });
});

describe('sessionVoiceOptions', () => {
  it('sends each spoken language its own setup, and the flat fields from the first', () => {
    const settings = {
      ...DEFAULT_TRANSLATE_SETTINGS,
      ...languageVoicePatch(
        languageVoicePatch(DEFAULT_TRANSLATE_SETTINGS, 'vi', { speak: false }),
        'en',
        { speed: 1.5, gender: 'male', voice: 'am_adam', volume: 0.2 },
      ),
    };
    expect(
      sessionVoiceOptions(settings, spokenLanguagesOf({ source: 'vi', target: 'en' }, 'two-way')),
    ).toEqual({
      voiceGender: 'male',
      voiceOutput: true,
      speed: 1.5,
      voice: 'am_adam',
      voiceByLanguage: {
        en: { speak: true, speed: 1.5, gender: 'male', voice: 'am_adam' },
        vi: { speak: false, speed: 1, gender: DEFAULT_LANGUAGE_VOICE.gender },
      },
    });
  });

  it('a one-way start speaks only its target, auto-detect included', () => {
    expect(spokenLanguagesOf({ source: 'vi', target: 'en' }, 'one-way')).toEqual(['en']);
    expect(spokenLanguagesOf({ source: 'detect', target: 'vi' }, 'one-way')).toEqual(['vi']);
  });

  it('changing one language leaves the others and the frozen defaults alone', () => {
    const patched = languageVoicePatch(DEFAULT_TRANSLATE_SETTINGS, 'vi', { speak: false });
    expect(patched.voiceByLanguage.vi.speak).toBe(false);
    expect(patched.voiceByLanguage.en).toBe(DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage.en);
    expect(DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage.vi.speak).toBe(true);
  });
});
