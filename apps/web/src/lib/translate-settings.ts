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

/**
 * How many streams the transcript draws, and how the two of them are arranged.
 *
 * Two fields rather than three arrangements in one enum, because that is the
 * shape the reader is offered: a mode, and — only under `split` — an orientation
 * for the two panes it creates. `list` has no orientation, so `paneLayout` is
 * simply not read there; it keeps its stored value so that switching back to
 * `split` returns the arrangement the reader last chose rather than the default.
 */
const displayModeSchema = z.enum(['split', 'list']);
type DisplayMode = z.infer<typeof displayModeSchema>;

const paneLayoutSchema = z.enum(['row', 'column']);
type PaneLayout = z.infer<typeof paneLayoutSchema>;

/**
 * The reading sizes, as multipliers of the shared type scale.
 *
 * Ten steps because that is what was asked for, and the range is what makes ten
 * of them worth having: end to end the transcript goes from just under to just
 * over double, which is a real span even though one step is barely a pixel on the
 * source line. Anything narrower would be ten names for one size.
 *
 * Step 3 is 1× — the neutral point, the size the transcript has always been, and
 * the default. Two steps BELOW it exist because a long conversation on a laptop
 * is a case for less, not only more.
 *
 * Multipliers, never sizes. The two lines they scale are `--text-body` and
 * `--text-translation`, and the ratio between those is a design decision the
 * transcript depends on — the translation is the thing being read. A table of
 * absolute sizes would let the two drift apart at some step nobody looked at.
 */
export const TEXT_SIZE_SCALES = [0.85, 0.925, 1, 1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2] as const;

/** 1-based, matching the numbers printed under the slider. */
export const DEFAULT_TEXT_SIZE = 3;

/** The multiplier for a step, for the one place that writes `--reading-scale`. */
export function textSizeScale(step: number): number {
  return TEXT_SIZE_SCALES[snapTextSize(step) - 1]!;
}

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
  displayMode: DisplayMode;
  /** Read only under `displayMode: 'split'`, and remembered across `list`. */
  paneLayout: PaneLayout;
  /** Whether a turn says who spoke it. Off hides the chip, never the attribution. */
  speakerLabels: boolean;
  /** Drop the recognized source line and keep only what it was translated into. */
  translationOnly: boolean;
  /** Never follow the conversation, even from the very bottom of the stream. */
  freeScroll: boolean;
  /** 1..10 into {@link TEXT_SIZE_SCALES}. */
  textSize: number;
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
  // Two panes side by side, because the screen is two panels with two headers
  // naming the two languages — one merged stream under them contradicts the frame
  // it sits in. Both panes collapse to one on a narrow viewport anyway.
  displayMode: 'split',
  paneLayout: 'row',
  // On, because a two-way conversation is the case this screen exists for, and a
  // transcript of one that does not say who spoke is a transcript of nobody.
  speakerLabels: true,
  // Off: the source line is how a speaker catches a misrecognition, so hiding it
  // is a choice a reader makes rather than one made for them.
  translationOnly: false,
  // Off, which is to say the transcript follows the conversation — see
  // `transcript-scroller.tsx` for why scrolling away already stops it.
  freeScroll: false,
  textSize: DEFAULT_TEXT_SIZE,
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

/** Onto the printed grid, so a hand-edited 3.5 or 40 is still a step that exists. */
function snapTextSize(value: number): number {
  return Math.round(clamp(value, 1, TEXT_SIZE_SCALES.length));
}

/**
 * Storage format. Bumped when a stored value has to be reinterpreted rather than
 * merely read — see {@link migrate}.
 */
const SETTINGS_VERSION = 3;

/**
 * Bring a stored blob up to {@link SETTINGS_VERSION}, one step at a time.
 *
 * ## v2 — drop a `transcriptLayout` nobody actually chose
 *
 * `set` writes the WHOLE settings object on any change, so anyone who ever moved
 * the volume slider has the layout of the day persisted alongside it. When the
 * default flipped, that stored copy kept every returning user on the old body
 * under the new headers — a redesign that shipped to new accounts only, and
 * looked like a bug to everyone else.
 *
 * The version stamp is what separates "was written because the user chose it"
 * from "was written because it happened to be the default at the time". An
 * unversioned blob is the second case by definition: the field predates anyone
 * being asked. So it is dropped once, the stamp is written, and every later
 * change is a real choice that is kept.
 *
 * ## v3 — one layout field becomes two
 *
 * The transcript grew a second axis: a mode, and an orientation for the two panes
 * the `split` mode creates. `columns` was two panes side by side and `stacked` was
 * one merged stream, so the old value MAPS rather than being dropped — and that
 * is precisely what v2 bought. Everything reaching this step still carrying a
 * `transcriptLayout` has already survived v2, which means a person chose it.
 *
 * Note the ordering: a pre-v2 blob has its layout deleted before this step reads
 * it, so it maps nothing and takes the defaults. That is correct, and it is why
 * these are steps rather than one branch.
 *
 * The four fields added alongside need no step at all. An absent field reads as
 * its default, which is the whole reason `loadTranslateSettings` merges over
 * {@link DEFAULT_TRANSLATE_SETTINGS} before parsing.
 */
function migrate(stored: Record<string, unknown>): Record<string, unknown> {
  const version = typeof stored.version === 'number' ? stored.version : 0;
  // A store written by a NEWER build — a rollback, or two branches sharing an
  // origin — has already been asked every question below, and re-running these
  // over it would drop a choice made after this code was written.
  //
  // **This protects the READ and nothing further, deliberately.** The next save
  // stamps `SETTINGS_VERSION` like any other, so a v4 store becomes a v3 store as
  // soon as anything is changed. Carrying the observed stamp through instead was
  // considered and is worse: the whitelist below has already dropped every field
  // v4 added, so writing back a v4 stamp would describe a blob as answering
  // questions whose answers are gone — and the v3-to-v4 step, the one thing that
  // could restore them, would then skip it. Downgrading the stamp alongside the
  // fields is the honest record of what this build did.
  if (version >= SETTINGS_VERSION) return stored;

  const next: Record<string, unknown> = { ...stored };

  if (version < 2) delete next.transcriptLayout;

  if (version < 3) {
    const layout = next.transcriptLayout;
    delete next.transcriptLayout;
    if (layout === 'columns') {
      next.displayMode = 'split';
      next.paneLayout = 'row';
    } else if (layout === 'stacked') {
      next.displayMode = 'list';
    }
  }

  next.version = SETTINGS_VERSION;
  return next;
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
  displayMode: displayModeSchema.catch(DEFAULT_TRANSLATE_SETTINGS.displayMode),
  paneLayout: paneLayoutSchema.catch(DEFAULT_TRANSLATE_SETTINGS.paneLayout),
  speakerLabels: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.speakerLabels),
  translationOnly: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.translationOnly),
  freeScroll: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.freeScroll),
  // Snapped, not merely bounded, for the same reason as the speed above: a value
  // inside the range but off the grid leaves the slider between two stops.
  textSize: z.number().catch(DEFAULT_TRANSLATE_SETTINGS.textSize).transform(snapTextSize),
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
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const merged = { ...DEFAULT_TRANSLATE_SETTINGS, ...migrate(stored) };
    // `version` decides the migration and is then dropped — the schema declares no
    // such field and Zod strips what it does not declare. It is a fact about the
    // STORE, and letting it into the settings object would put it in reach of
    // every consumer and eventually into a comparison.
    const parsed = storedSettingsSchema.parse(merged);
    const settings: TranslateSettings = {
      direction: parsed.direction,
      voiceGender: parsed.voiceGender,
      voiceOutput: parsed.voiceOutput,
      speed: parsed.speed,
      voice: parsed.voice,
      volume: parsed.volume,
      displayMode: parsed.displayMode,
      paneLayout: parsed.paneLayout,
      speakerLabels: parsed.speakerLabels,
      translationOnly: parsed.translationOnly,
      freeScroll: parsed.freeScroll,
      textSize: parsed.textSize,
    };
    return settings;
  } catch {
    // Unparseable JSON, storage disabled by policy, or a private window that
    // throws on access. Defaults are always a state the UI can render.
    return DEFAULT_TRANSLATE_SETTINGS;
  }
}

export function saveTranslateSettings(settings: TranslateSettings): void {
  try {
    // The stamp travels with the write, not with the type: a save is a deliberate
    // choice, so what it stores has been chosen and must not be migrated again.
    localStorage.setItem(
      TRANSLATE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...settings, version: SETTINGS_VERSION }),
    );
  } catch {
    // The choice still holds for this page; it just will not outlive it.
  }
}
