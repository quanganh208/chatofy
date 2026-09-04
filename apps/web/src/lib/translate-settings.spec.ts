// @vitest-environment happy-dom
//
// The suite defaults to `node` because the audio and transport modules under test
// are deliberately DOM-free. This one is not: the whole point of the module is what
// it does with `localStorage`, including when the browser refuses it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  SPEED_PRESETS,
  TEXT_SIZE_SCALES,
  TRANSLATE_SETTINGS_STORAGE_KEY,
  loadTranslateSettings,
  saveTranslateSettings,
  textSizeScale,
} from './translate-settings';

/**
 * What a stored value is allowed to do to the page.
 *
 * The interesting cases are not "does a round trip work" but "what happens when
 * the store holds something this build cannot represent" — because that is not
 * hypothetical: the store outlives the build that wrote it, and a setting the UI
 * cannot render is a state the user has no control to escape from.
 */

function store(value: unknown): void {
  localStorage.setItem(TRANSLATE_SETTINGS_STORAGE_KEY, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadTranslateSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadTranslateSettings()).toEqual(DEFAULT_TRANSLATE_SETTINGS);
  });

  it('round-trips what was saved', () => {
    const settings = { ...DEFAULT_TRANSLATE_SETTINGS, volume: 0.4, voiceOutput: false };
    saveTranslateSettings(settings);
    expect(loadTranslateSettings()).toEqual(settings);
  });

  it('merges a partial written by an older build over the defaults', () => {
    // The field that build had not invented yet must arrive at its default rather
    // than as undefined, or every consumer needs its own fallback.
    store({ volume: 0.5 });
    const loaded = loadTranslateSettings();
    expect(loaded.volume).toBe(0.5);
    expect(loaded.voiceOutput).toBe(DEFAULT_TRANSLATE_SETTINGS.voiceOutput);
    expect(loaded.displayMode).toBe(DEFAULT_TRANSLATE_SETTINGS.displayMode);
    expect(loaded.speakerLabels).toBe(DEFAULT_TRANSLATE_SETTINGS.speakerLabels);
    expect(loaded.textSize).toBe(DEFAULT_TRANSLATE_SETTINGS.textSize);
  });

  it('clamps a volume outside 0..1', () => {
    store({ volume: 4 });
    expect(loadTranslateSettings().volume).toBe(1);
    store({ volume: -2 });
    expect(loadTranslateSettings().volume).toBe(0);
  });

  it('snaps an in-range speed that is not one of the presets', () => {
    // The case a clamp alone misses. 0.9 is a legal rate and would leave the
    // segmented control with no segment selected — a control that has lost its
    // value rather than one set to something unusual.
    store({ speed: 0.9 });
    const snapped = loadTranslateSettings().speed;
    expect(SPEED_PRESETS).toContain(snapped);
    expect(snapped).toBe(1);

    store({ speed: 1.3 });
    expect(loadTranslateSettings().speed).toBe(1.25);
  });

  it('clamps a speed outside the accepted bounds before snapping', () => {
    store({ speed: 99 });
    expect(loadTranslateSettings().speed).toBe(1.5);
  });

  it('drops a voice token longer than the wire cap', () => {
    // The cap is chosen to match the wire field that phase 5 will add. It does not
    // exist yet, so this bound is the client's own for now, not an agreement.
    store({ voice: { en: 'x'.repeat(65), vi: 'Mai Anh' } });
    const { voice } = loadTranslateSettings();
    expect(voice.en).toBeUndefined();
    expect(voice.vi).toBe('Mai Anh');
  });

  it('keeps a voice token it cannot verify', () => {
    // Which voices exist is fetched over HTTP; a synchronous read cannot know.
    // Bounding is this layer's whole job — reconciliation happens at the point of
    // use, once the catalog has resolved.
    store({ voice: { en: 'a-voice-this-build-never-heard-of' } });
    expect(loadTranslateSettings().voice.en).toBe('a-voice-this-build-never-heard-of');
  });

  it('falls back on an unknown display mode or pane layout', () => {
    store({ displayMode: 'diagonal', paneLayout: 'spiral', version: 3 });
    // Named through the defaults rather than spelled out, so flipping which
    // arrangement ships first does not turn this into an assertion about a literal.
    const loaded = loadTranslateSettings();
    expect(loaded.displayMode).toBe(DEFAULT_TRANSLATE_SETTINGS.displayMode);
    expect(loaded.paneLayout).toBe(DEFAULT_TRANSLATE_SETTINGS.paneLayout);
  });

  it('snaps a text size off the printed grid', () => {
    // Clamping alone would leave the slider parked between two stops, which reads
    // as a control that has lost its value rather than one set to something odd.
    store({ textSize: 3.6, version: 3 });
    expect(loadTranslateSettings().textSize).toBe(4);
    store({ textSize: 99, version: 3 });
    expect(loadTranslateSettings().textSize).toBe(TEXT_SIZE_SCALES.length);
    store({ textSize: -4, version: 3 });
    expect(loadTranslateSettings().textSize).toBe(1);
  });

  it('falls back on an unknown direction or gender', () => {
    store({ direction: 'fr_to_en', voiceGender: 'robot' });
    const loaded = loadTranslateSettings();
    expect(loaded.direction).toBe(DEFAULT_TRANSLATE_SETTINGS.direction);
    expect(loaded.voiceGender).toBe(DEFAULT_TRANSLATE_SETTINGS.voiceGender);
  });

  it('falls back field by field, not wholesale', () => {
    // One bad number must not discard five good choices.
    store({ volume: 'loud', voiceOutput: false, displayMode: 'list', version: 3 });
    const loaded = loadTranslateSettings();
    expect(loaded.volume).toBe(DEFAULT_TRANSLATE_SETTINGS.volume);
    expect(loaded.voiceOutput).toBe(false);
    expect(loaded.displayMode).toBe('list');
  });

  it('returns the defaults for a blob that is not JSON', () => {
    localStorage.setItem(TRANSLATE_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadTranslateSettings()).toEqual(DEFAULT_TRANSLATE_SETTINGS);
  });

  it('survives storage that throws', () => {
    // A private window, or storage disabled by policy. The page must still render.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadTranslateSettings()).toEqual(DEFAULT_TRANSLATE_SETTINGS);
  });
});

describe('saveTranslateSettings', () => {
  it('does not throw when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveTranslateSettings(DEFAULT_TRANSLATE_SETTINGS)).not.toThrow();
  });
});

describe('the speed presets', () => {
  it('are all at or above 1.0', () => {
    // Below 1.0 the synthesized audio outlasts the cadence turns arrive at, the
    // playback backlog grows without bound, and OrderedPlayback drops whole turns.
    // A slower-speech setting that silently deletes sentences is not a setting.
    for (const preset of SPEED_PRESETS) expect(preset).toBeGreaterThanOrEqual(1);
  });
});

describe('the stored layout, across two migrations', () => {
  /**
   * v2: `set` writes the WHOLE object on any change, so a user who only ever moved
   * the volume slider still has that day's default layout persisted beside it. When
   * the default flipped, those users kept the old body under the new panel headers —
   * a redesign that reached new accounts only.
   */
  it('drops a layout written before anyone was asked', () => {
    store({ volume: 0.4, transcriptLayout: 'stacked' });
    const loaded = loadTranslateSettings();
    expect(loaded.displayMode).toBe(DEFAULT_TRANSLATE_SETTINGS.displayMode);
    // Only that field. Everything else the user actually set survives.
    expect(loaded.volume).toBe(0.4);
  });

  /**
   * v3: one layout field became a mode and an orientation. A value that reached
   * this step has already survived v2, which is exactly what says a person chose
   * it — so it is MAPPED rather than dropped.
   */
  it('maps a chosen two-column layout onto split panes', () => {
    store({ volume: 0.4, transcriptLayout: 'columns', version: 2 });
    const loaded = loadTranslateSettings();
    expect(loaded.displayMode).toBe('split');
    expect(loaded.paneLayout).toBe('row');
    expect(loaded.volume).toBe(0.4);
  });

  it('maps a chosen stacked layout onto the merged list', () => {
    store({ transcriptLayout: 'stacked', version: 2 });
    expect(loadTranslateSettings().displayMode).toBe('list');
  });

  it('leaves the new fields at their defaults, having no stored answer', () => {
    // The four switches added alongside need no migration step: absent reads as
    // the default, which is what the merge over the defaults is for.
    store({ transcriptLayout: 'columns', version: 2 });
    const loaded = loadTranslateSettings();
    expect(loaded.speakerLabels).toBe(DEFAULT_TRANSLATE_SETTINGS.speakerLabels);
    expect(loaded.translationOnly).toBe(DEFAULT_TRANSLATE_SETTINGS.translationOnly);
    expect(loaded.freeScroll).toBe(DEFAULT_TRANSLATE_SETTINGS.freeScroll);
    expect(loaded.textSize).toBe(DEFAULT_TRANSLATE_SETTINGS.textSize);
  });

  it('takes the defaults for a pre-v2 layout, which v2 has already deleted', () => {
    // The ordering matters and this is what proves it: v2 removes the field before
    // v3 can read it, so an unversioned blob maps nothing rather than carrying a
    // layout nobody chose all the way into the new pair of fields.
    store({ transcriptLayout: 'stacked' });
    expect(loadTranslateSettings().displayMode).toBe(DEFAULT_TRANSLATE_SETTINGS.displayMode);
  });

  it('does not migrate a store written by a newer build', () => {
    // A rollback, or two branches sharing an origin. Every question below has been
    // asked already, and re-running these would drop an answer given after this
    // code was written.
    store({ displayMode: 'list', transcriptLayout: 'columns', version: 4 });
    expect(loadTranslateSettings().displayMode).toBe('list');
  });

  it('stamps its own version once the user changes anything', () => {
    // The guard above covers the READ. A save is this build writing what this
    // build can represent, so it claims its own version — the alternative, keeping
    // a v4 stamp over a blob whose v4 fields the whitelist has already dropped,
    // would tell a future v4 build there was nothing to restore.
    store({ displayMode: 'list', version: 4 });
    saveTranslateSettings({ ...loadTranslateSettings(), textSize: 6 });
    const raw = localStorage.getItem(TRANSLATE_SETTINGS_STORAGE_KEY) ?? '{}';
    expect((JSON.parse(raw) as { version: number }).version).toBe(3);
  });

  it('stamps what it writes, so the next load leaves it alone', () => {
    saveTranslateSettings({ ...DEFAULT_TRANSLATE_SETTINGS, displayMode: 'list' });
    expect(loadTranslateSettings().displayMode).toBe('list');
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
