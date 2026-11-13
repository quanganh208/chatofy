import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE_PAIR,
  DEFAULT_MIC_PROCESSING,
  LANGUAGE_CODES,
  defaultUserPreferences,
  mergePreferences,
  parseUserPreferences,
  userPreferencesPatchSchema,
  type UserPreferences,
} from '@chatofy/types';
import {
  DEFAULT_LANGUAGE_VOICE,
  DEFAULT_STAGE_APPEARANCE,
  DEFAULT_TRANSLATE_SETTINGS,
  SPEED_PRESETS,
  TEXT_SIZE_SCALES,
  languageVoicePatch,
  type TranslateSettings,
} from './translate-settings';
import {
  preferencesPatchFromTranslateSettings,
  translateSettingsFromPreferences,
} from './translate-settings-preferences';

/**
 * What a stored document is allowed to do to the page.
 *
 * The interesting cases are not "does a round trip work" but "what happens when
 * the document holds something this build cannot represent" — because that is not
 * hypothetical: the document is shared with two other clients and outlives the
 * build that wrote it, and a setting the UI cannot render is a state the user has
 * no control to escape from.
 */
const BASE = defaultUserPreferences('en');

/**
 * Read a raw document the way the store does: through the contract's tolerant
 * parse, then the web's own whitelist.
 */
function read(raw: Record<string, unknown>): TranslateSettings {
  const document = {
    ...BASE,
    ...raw,
    pairs: { ...BASE.pairs, ...(raw.pairs as object | undefined) },
  };
  return translateSettingsFromPreferences(
    parseUserPreferences(document, BASE),
    DEFAULT_MIC_PROCESSING,
  );
}

/** Write settings as a PATCH over the defaults, then read them back. */
function roundTrip(settings: TranslateSettings): TranslateSettings {
  const patch = preferencesPatchFromTranslateSettings(settings, BASE);
  const stored: UserPreferences = mergePreferences(BASE, patch);
  return translateSettingsFromPreferences(stored, settings.micProcessing);
}

describe('reading a document', () => {
  it('reads an empty document as the defaults', () => {
    expect(read({})).toEqual({
      ...DEFAULT_TRANSLATE_SETTINGS,
      languagePair: BASE.pairs.webOneWay,
      twoWayPair: BASE.pairs.webTwoWay,
    });
  });

  it('round-trips everything it writes', () => {
    const settings: TranslateSettings = {
      ...DEFAULT_TRANSLATE_SETTINGS,
      ...languageVoicePatch(DEFAULT_TRANSLATE_SETTINGS, 'vi', {
        volume: 0.4,
        speak: false,
        voice: 'Mai Anh',
      }),
      languagePair: { source: 'detect', target: 'vi' },
      twoWayPair: { source: 'en', target: 'vi' },
      displayMode: 'list',
      paneLayout: 'column',
      speakerLabels: false,
      translationOnly: true,
      freeScroll: true,
      transcriptOrder: 'newest-first',
      textSize: 7,
      contextId: 'ctx-1',
      appearance: {
        ...DEFAULT_TRANSLATE_SETTINGS.appearance,
        targetColor: 'amber',
        background: '#123456',
        backgroundOpacity: 60,
      },
      stage: { ...DEFAULT_STAGE_APPEARANCE, followPage: true, textSize: 8 },
    };
    expect(roundTrip(settings)).toEqual(settings);
  });

  it("fills a language's absent fields with that language's defaults", () => {
    // A mobile build that only knows `speak` writes only `speak`; the rest of the
    // web's setup must still be a full one.
    const { voiceByLanguage } = read({ voices: { vi: { speak: false } } });
    expect(voiceByLanguage.vi).toEqual({ ...DEFAULT_LANGUAGE_VOICE, speak: false });
    expect(voiceByLanguage.en).toEqual(DEFAULT_LANGUAGE_VOICE);
  });

  it('snaps an in-range speed that is not one of the presets', () => {
    // The case a clamp alone misses. 0.9 is a legal rate and would leave the
    // segmented control with no segment selected.
    const speed = read({ voices: { en: { speed: 0.9 } } }).voiceByLanguage.en.speed;
    expect(SPEED_PRESETS).toContain(speed);
    expect(speed).toBe(1);
    expect(read({ voices: { en: { speed: 1.3 } } }).voiceByLanguage.en.speed).toBe(1.25);
  });

  it('reads every language on its own: one bad setup never resets another', () => {
    for (const code of LANGUAGE_CODES) {
      const other = LANGUAGE_CODES.find((candidate) => candidate !== code);
      if (!other) continue;
      const { voiceByLanguage } = read({
        voices: { [code]: { speed: 99 }, [other]: { speak: false, voice: 'Mai Anh' } },
      });
      expect(voiceByLanguage[code]).toEqual(DEFAULT_LANGUAGE_VOICE);
      expect(voiceByLanguage[other]).toMatchObject({ speak: false, voice: 'Mai Anh' });
    }
  });

  it('keeps a voice token it cannot verify', () => {
    // Which voices exist is fetched over HTTP; reconciliation happens at the point
    // of use, once the catalog has resolved.
    expect(read({ voices: { en: { voice: 'never-heard-of-it' } } }).voiceByLanguage.en.voice).toBe(
      'never-heard-of-it',
    );
  });

  it('falls back field by field inside `reading`, not wholesale', () => {
    // One bad number must not discard the reader's other choices.
    const loaded = read({
      reading: { displayMode: 'diagonal', paneLayout: 'column', textSize: 'big', freeScroll: true },
    });
    expect(loaded.displayMode).toBe(DEFAULT_TRANSLATE_SETTINGS.displayMode);
    expect(loaded.textSize).toBe(DEFAULT_TRANSLATE_SETTINGS.textSize);
    expect(loaded.paneLayout).toBe('column');
    expect(loaded.freeScroll).toBe(true);
  });

  it('reads the transcript order, oldest first when absent or unreadable', () => {
    expect(read({}).transcriptOrder).toBe('oldest-first');
    expect(read({ reading: { transcriptOrder: 'newest-first' } }).transcriptOrder).toBe(
      'newest-first',
    );
    const loaded = read({ reading: { transcriptOrder: 'sideways', freeScroll: true } });
    expect(loaded.transcriptOrder).toBe('oldest-first');
    expect(loaded.freeScroll).toBe(true);
  });

  it('snaps a text size off the printed grid', () => {
    expect(read({ reading: { textSize: 3.6 } }).textSize).toBe(4);
    expect(read({ reading: { textSize: 99 } }).textSize).toBe(TEXT_SIZE_SCALES.length);
    expect(read({ reading: { textSize: -4 } }).textSize).toBe(1);
  });

  it('drops a reading field this build does not know', () => {
    expect(read({ reading: { fromTheFuture: 1 } })).not.toHaveProperty('fromTheFuture');
  });

  it('falls back per field inside an appearance, and for one that is not an object', () => {
    const { appearance } = read({
      reading: { appearance: { targetColor: 'not-a-colour', sourceColor: 'rose', font: 'comic' } },
    });
    expect(appearance.targetColor).toBe('default');
    expect(appearance.sourceColor).toBe('rose');
    expect(appearance.font).toBe('sans');

    const loaded = read({ reading: { appearance: 'bright', stage: 7 } });
    expect(loaded.appearance).toEqual(DEFAULT_TRANSLATE_SETTINGS.appearance);
    expect(loaded.stage).toEqual(DEFAULT_STAGE_APPEARANCE);
  });

  it('keeps a detected source, except into a language that rules it out', () => {
    expect(read({ pairs: { webOneWay: { source: 'detect', target: 'en' } } }).languagePair).toEqual(
      { source: 'detect', target: 'en' },
    );
    // A turn said in Chinese cannot be recognised as Chinese, so "detect into
    // Chinese" would force it into another language — not a state to restore.
    expect(read({ pairs: { webOneWay: { source: 'detect', target: 'zh' } } }).languagePair).toEqual(
      { source: 'vi', target: 'zh' },
    );
  });

  it('refuses a two-way pair that cannot run two-way', () => {
    expect(read({ pairs: { webTwoWay: { source: 'zh', target: 'vi' } } }).twoWayPair).toEqual(
      DEFAULT_LANGUAGE_PAIR,
    );
  });

  it('reads the microphone chain from the device, never the document', () => {
    const mic = { ...DEFAULT_MIC_PROCESSING, noiseSuppression: false };
    expect(translateSettingsFromPreferences(BASE, mic).micProcessing).toBe(mic);
  });
});

describe('writing a change', () => {
  it('names only the fields the change names', () => {
    expect(preferencesPatchFromTranslateSettings({ textSize: 5 })).toEqual({
      reading: { textSize: 5 },
    });
    expect(
      preferencesPatchFromTranslateSettings({ twoWayPair: { source: 'en', target: 'vi' } }),
    ).toEqual({ pairs: { webTwoWay: { source: 'en', target: 'vi' } } });
  });

  it('never sends the microphone chain', () => {
    expect(
      preferencesPatchFromTranslateSettings({ micProcessing: DEFAULT_MIC_PROCESSING }),
    ).toEqual({});
  });

  it('writes only what the contract accepts, so a save is never refused', () => {
    // A PATCH the API refuses is dropped with the reader's change in it; the values
    // a settings object can legally hold but the contract cannot must not reach it.
    const named = mergePreferences(BASE, { voices: { vi: { voice: 'Mai Anh' } } });
    const patch = preferencesPatchFromTranslateSettings(
      {
        ...DEFAULT_TRANSLATE_SETTINGS,
        contextId: '',
        voiceByLanguage: {
          ...DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage,
          en: { ...DEFAULT_LANGUAGE_VOICE, voice: '' },
          vi: { ...DEFAULT_LANGUAGE_VOICE, voice: 'x'.repeat(65), speed: 3, volume: -4 },
        },
      },
      named,
    );
    expect(userPreferencesPatchSchema.safeParse(patch).success).toBe(true);
    expect(patch.contextId).toBeNull();
    // No token stored and none representable: nothing to clear.
    expect(patch.voices?.en).toBeUndefined();
    expect(patch.voices?.vi).toEqual({ speed: 2, volume: 0, voice: null });
  });

  it('sends only the language and field that changed', () => {
    const patch = preferencesPatchFromTranslateSettings(
      languageVoicePatch(DEFAULT_TRANSLATE_SETTINGS, 'vi', { volume: 0.4 }),
      BASE,
    );
    expect(patch).toEqual({ voices: { vi: { volume: 0.4 } } });
  });

  it("never overwrites another device's change to a language this tab did not touch", () => {
    // This tab rendered before the phone picked an English voice; the reader then
    // moves the Vietnamese volume. The server must keep the phone's pick.
    const stale = translateSettingsFromPreferences(BASE, DEFAULT_MIC_PROCESSING);
    const server = mergePreferences(BASE, { voices: { en: { voice: 'af_bella', speed: 1.5 } } });
    const patch = preferencesPatchFromTranslateSettings(
      languageVoicePatch(stale, 'vi', { volume: 0.4 }),
      BASE,
    );
    const stored = mergePreferences(server, patch);
    expect(stored.voices.en).toEqual({ voice: 'af_bella', speed: 1.5 });
    expect(stored.voices.vi).toEqual({ volume: 0.4 });
  });

  it('sends nothing for a change back to what is already shown', () => {
    expect(
      preferencesPatchFromTranslateSettings(
        { voiceByLanguage: DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage },
        BASE,
      ),
    ).toEqual({});
  });

  it('removes a named voice when the gender changes, rather than keeping it', () => {
    // "Male" with no voice named means the male default. Leaving `voice` out of the
    // patch would merge over the stored token and keep the old voice speaking.
    const named = mergePreferences(BASE, { voices: { en: { voice: 'af_bella' } } });
    const patch = preferencesPatchFromTranslateSettings(
      languageVoicePatch(translateSettingsFromPreferences(named, DEFAULT_MIC_PROCESSING), 'en', {
        gender: 'male',
        voice: undefined,
      }),
      named,
    );
    expect(patch).toEqual({ voices: { en: { gender: 'male', voice: null } } });
    const stored = mergePreferences(named, patch);
    expect(stored.voices.en).not.toHaveProperty('voice');
    expect(
      translateSettingsFromPreferences(stored, DEFAULT_MIC_PROCESSING).voiceByLanguage.en,
    ).toEqual({ ...DEFAULT_LANGUAGE_VOICE, gender: 'male' });
  });
});
