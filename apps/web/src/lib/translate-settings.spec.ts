// @vitest-environment happy-dom
//
// The suite defaults to `node` because the audio and transport modules under test
// are deliberately DOM-free. This one is not: the whole point of the module is what
// it does with `localStorage`, including when the browser refuses it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  SPEED_PRESETS,
  TRANSLATE_SETTINGS_STORAGE_KEY,
  loadTranslateSettings,
  saveTranslateSettings,
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
    expect(loaded.transcriptLayout).toBe(DEFAULT_TRANSLATE_SETTINGS.transcriptLayout);
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

  it('falls back on an unknown transcript layout', () => {
    store({ transcriptLayout: 'diagonal' });
    // Named through the default rather than spelled out, so flipping which layout
    // ships first does not silently turn this into an assertion about a literal.
    expect(loadTranslateSettings().transcriptLayout).toBe(
      DEFAULT_TRANSLATE_SETTINGS.transcriptLayout,
    );
  });

  it('falls back on an unknown direction or gender', () => {
    store({ direction: 'fr_to_en', voiceGender: 'robot' });
    const loaded = loadTranslateSettings();
    expect(loaded.direction).toBe(DEFAULT_TRANSLATE_SETTINGS.direction);
    expect(loaded.voiceGender).toBe(DEFAULT_TRANSLATE_SETTINGS.voiceGender);
  });

  it('falls back field by field, not wholesale', () => {
    // One bad number must not discard five good choices.
    store({ volume: 'loud', voiceOutput: false, transcriptLayout: 'stacked', version: 2 });
    const loaded = loadTranslateSettings();
    expect(loaded.volume).toBe(DEFAULT_TRANSLATE_SETTINGS.volume);
    expect(loaded.voiceOutput).toBe(false);
    expect(loaded.transcriptLayout).toBe('stacked');
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

describe('the stored layout nobody chose', () => {
  /**
   * `set` writes the WHOLE object on any change, so a user who only ever moved the
   * volume slider still has that day's default layout persisted beside it. When the
   * default flipped, those users kept the old body under the new panel headers —
   * a redesign that reached new accounts only.
   */
  it('drops a layout written before anyone was asked', () => {
    store({ volume: 0.4, transcriptLayout: 'stacked' });
    const loaded = loadTranslateSettings();
    expect(loaded.transcriptLayout).toBe(DEFAULT_TRANSLATE_SETTINGS.transcriptLayout);
    // Only that field. Everything else the user actually set survives.
    expect(loaded.volume).toBe(0.4);
  });

  it('keeps a layout chosen since, and does not migrate twice', () => {
    store({ volume: 0.4, transcriptLayout: 'stacked', version: 2 });
    expect(loadTranslateSettings().transcriptLayout).toBe('stacked');
  });

  it('stamps what it writes, so the next load leaves it alone', () => {
    saveTranslateSettings({ ...DEFAULT_TRANSLATE_SETTINGS, transcriptLayout: 'stacked' });
    expect(loadTranslateSettings().transcriptLayout).toBe('stacked');
  });
});
