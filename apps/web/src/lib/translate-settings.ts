/**
 * What the translator remembers between visits.
 *
 * One object, one key, read once after mount. The shape is declared whole here —
 * including fields no UI writes yet — so the schema and its spec are written once
 * rather than edited by every phase that adds a control.
 *
 * Modelled on `apps/extension/src/settings.ts`: merge the stored partial over the
 * defaults, then WHITELIST each field rather than trusting what came back. A value
 * written by an older build is not hostile, but it is unknown, and a setting the
 * current UI cannot represent is a state the user cannot leave — the extension hit
 * exactly that with a stored mode whose control had been removed.
 *
 * Nothing here affects first paint, so unlike the theme (`app/layout.tsx`) this
 * needs no blocking script and must be read after mount. Reading it in a
 * `useState` initializer would render one value on the server and another on the
 * client.
 */
import { z } from 'zod';
import {
  DEFAULT_VOICE_GENDER,
  translationDirectionSchema,
  voiceGenderSchema,
} from '@chatofy/types';

export const TRANSLATE_SETTINGS_STORAGE_KEY = 'chatofy.translate-settings';

/**
 * Speaking rates the UI offers.
 *
 * All at or above 1.0, and that is a measured decision rather than a preference.
 * Capture runs continuously with an 8s ceiling per turn, so a turn arrives at
 * least every 8s; below 1.0 the synthesized audio is stretched by 1/rate, so at
 * 0.75x an ~8s translation plays for ~10.7s. Utilisation passes 100% permanently,
 * the playback backlog grows monotonically, and `OrderedPlayback` starts dropping
 * whole turns once it crosses its 12s ceiling. The user would be choosing "slower
 * speech" and silently losing sentences.
 *
 * A sub-1.0 preset may only ship alongside a visible marker for a dropped turn.
 */
export const SPEED_PRESETS = [1, 1.25, 1.5] as const;

/**
 * Sanity bounds for a stored rate. Wider than {@link SPEED_PRESETS} on purpose —
 * this refuses nonsense, it does not enforce which buttons exist.
 *
 * Chosen AHEAD of the wire field: `sessionOptionsSchema` has no `speed` yet.
 * Re-check these against it when that field lands, rather than assuming they agree.
 */
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

/**
 * Longest voice token kept.
 *
 * Also chosen ahead of the wire — there is no `voice` field on the wire yet either.
 * The intent is that the two caps match so a value stored here cannot be refused
 * later; reconcile it when the wire field exists.
 */
const VOICE_TOKEN_MAX = 64;

// Not exported until something outside this module names it — phase 3 wires the
// transcript's `layout` prop and can export it then. An export nothing imports is
// indistinguishable from one that has been orphaned, which is what `knip` guards.
const transcriptLayoutSchema = z.enum(['stacked', 'columns']);
type TranscriptLayout = z.infer<typeof transcriptLayoutSchema>;

/**
 * A chosen voice, keyed by the language it speaks.
 *
 * NOT a single string. The two engines address voices by disjoint vocabularies —
 * an integer speaker id for English, a preset name for Vietnamese — so one flat
 * token survives a direction change and is then sent to an engine that cannot
 * mean anything by it. Keyed by output language, a direction flip selects the
 * right token or none.
 *
 * Bounded but otherwise opaque, and deliberately never an enum: which voices
 * exist is a property of whichever backend is running, discovered at runtime.
 * Enumerating them here would hardcode one backend's vocabulary into the client.
 */
/**
 * Read leniently — each language catches on its own.
 *
 * An object-level `catch` would be wrong in a way that is easy to miss and annoying
 * to hit: one over-long English token would discard a perfectly good Vietnamese one,
 * because the whole object failed and fell back together.
 *
 * Phase 5 will want a STRICT counterpart of this for the value it puts on the wire.
 * It is not declared here, because a schema nothing validates with yet is
 * indistinguishable from one that has been orphaned.
 */
const storedVoiceSelectionSchema = z.object({
  en: z.string().max(VOICE_TOKEN_MAX).optional().catch(undefined),
  vi: z.string().max(VOICE_TOKEN_MAX).optional().catch(undefined),
});
type VoiceSelection = z.infer<typeof storedVoiceSelectionSchema>;

export interface TranslateSettings {
  direction: z.infer<typeof translationDirectionSchema>;
  voiceGender: z.infer<typeof voiceGenderSchema>;
  /** Whether the translation is spoken at all. */
  voiceOutput: boolean;
  /** Speaking rate. Honoured for English output; the Vietnamese engine has none. */
  speed: number;
  /** Empty until a catalog exists to choose from. */
  voice: VoiceSelection;
  /** Playback gain, 0..1. Never above 1 — see the settings panel. */
  volume: number;
  transcriptLayout: TranscriptLayout;
}

/**
 * Frozen, including the nested object.
 *
 * `loadTranslateSettings` hands this back on every fallback path, and `set`
 * spreads only the top level — so `voice` would stay pointed at this very object
 * until something replaced it wholesale. A later `settings.voice.en = token`, which
 * is the natural thing to write, would then edit the module's own defaults: every
 * subsequent fallback returns a "default" carrying a stale token, for the lifetime
 * of the page, on the exact path that exists to guarantee a renderable state.
 *
 * Frozen rather than cloned per call so the mistake throws in strict mode at the
 * moment it is made, instead of being absorbed silently.
 */
export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = Object.freeze({
  direction: 'vi_to_en',
  voiceGender: DEFAULT_VOICE_GENDER,
  voiceOutput: true,
  speed: 1,
  voice: Object.freeze({}),
  volume: 1,
  // Two columns, because the screen is now two panels with two headers naming
  // the two languages — a stacked body under them contradicts the frame it sits
  // in. `stacked` is still reachable and still correct on a narrow viewport,
  // where the columns collapse to one anyway.
  transcriptLayout: 'columns',
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Pull a stored rate onto the nearest rate the UI can actually show.
 *
 * Clamping alone is not enough. A value inside the bounds but off the preset grid
 * — 0.9, from a hand-edited store or a build whose presets differed — leaves the
 * segmented control with no segment selected, which renders as a control that has
 * lost its value rather than one set to something unusual.
 */
function snapSpeed(value: number): number {
  const bounded = clamp(value, SPEED_MIN, SPEED_MAX);
  let nearest: number = SPEED_PRESETS[0];
  for (const preset of SPEED_PRESETS) {
    if (Math.abs(preset - bounded) < Math.abs(nearest - bounded)) nearest = preset;
  }
  return nearest;
}

/**
 * The whitelist.
 *
 * Every field falls back independently: one unreadable value must not discard the
 * other five. `catch` per field rather than per object is what buys that — a
 * single object-level catch would reset a user's whole panel because one number
 * was out of range.
 */
const storedSettingsSchema = z.object({
  direction: translationDirectionSchema.catch(DEFAULT_TRANSLATE_SETTINGS.direction),
  voiceGender: voiceGenderSchema.catch(DEFAULT_TRANSLATE_SETTINGS.voiceGender),
  voiceOutput: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.voiceOutput),
  speed: z.number().catch(DEFAULT_TRANSLATE_SETTINGS.speed).transform(snapSpeed),
  // A token longer than the cap is dropped rather than truncated: half a token is
  // not a shorter token, it is a different one, and it would be refused downstream
  // anyway. Dropped per language — see `storedVoiceSelectionSchema`.
  voice: storedVoiceSelectionSchema.catch(DEFAULT_TRANSLATE_SETTINGS.voice),
  volume: z
    .number()
    .catch(DEFAULT_TRANSLATE_SETTINGS.volume)
    .transform((value) => clamp(value, 0, 1)),
  transcriptLayout: transcriptLayoutSchema.catch(DEFAULT_TRANSLATE_SETTINGS.transcriptLayout),
});

/**
 * Read the stored settings, falling back field by field.
 *
 * The persisted voice token is only BOUNDED here, never validated against a
 * catalog: which voices exist is fetched over HTTP and is not knowable to a
 * synchronous read. Reconciling a stale token belongs at the point of use, where
 * the catalog has resolved.
 */
export function loadTranslateSettings(): TranslateSettings {
  try {
    const raw = localStorage.getItem(TRANSLATE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_TRANSLATE_SETTINGS;
    const merged = { ...DEFAULT_TRANSLATE_SETTINGS, ...(JSON.parse(raw) as object) };
    return storedSettingsSchema.parse(merged);
  } catch {
    // Unparseable JSON, storage disabled by policy, or a private window that
    // throws on access. Defaults are always a state the UI can render.
    return DEFAULT_TRANSLATE_SETTINGS;
  }
}

export function saveTranslateSettings(settings: TranslateSettings): void {
  try {
    localStorage.setItem(TRANSLATE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The choice still holds for this page; it just will not outlive it.
  }
}
