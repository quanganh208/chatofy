/**
 * What the translator remembers between visits.
 *
 * One object, one key, read once per mount. The shape is declared whole here —
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
 * needs no blocking script — but it must not reach the hydrating render, which
 * would then show one value on the server and another on the client.
 * `useTranslateSettings` holds it back until hydration is done.
 */
import { z } from 'zod';
import {
  AUTO_DETECT,
  DEFAULT_LANGUAGE_PAIR,
  languagePairSchema,
  DEFAULT_MIC_PROCESSING,
  DEFAULT_VOICE_GENDER,
  IDENTIFIABLE_LANGUAGES,
  LANGUAGE_CODES,
  canIdentify,
  languagePairFromStoredDirection,
  sessionLanguagePairSchema,
  voiceGenderSchema,
  type LanguageCode,
  type SessionOptions,
  type VoiceGender,
  type LanguagePair,
  type LanguageTable,
  type MicProcessing,
  type SessionLanguagePair,
} from '@chatofy/types';
import {
  DEFAULT_READING_APPEARANCE,
  pickReadingAppearance,
  readingAppearanceShape,
  type ReadingAppearance,
} from '@/lib/reading-appearance';

export const TRANSLATE_SETTINGS_STORAGE_KEY = 'chatofy.translate-settings';

/**
 * Speaking rates the UI offers.
 *
 * The full range the wire accepts, 0.5x to 2x, which is a change of policy and
 * not a widening of a bound: the sub-1.0 half was withheld, and what it costs is
 * unchanged and worth restating.
 *
 * Capture runs continuously with an 8s ceiling per turn, so a turn arrives at
 * least every 8s; below 1.0 the synthesized audio is stretched by 1/rate, so at
 * 0.75x an ~8s translation plays for ~10.7s. Utilisation passes 100% permanently,
 * the playback backlog grows monotonically, and `OrderedPlayback` drops whole
 * turns once it crosses its 12s ceiling (`ordered-playback.ts`). The slow rates
 * are therefore usable in ordinary back-and-forth speech, where turns are short
 * and separated, and lossy under continuous speech — a lecture, a monologue.
 *
 * **What made that shippable is that it is no longer silent**: a turn that
 * actually goes unheard says so on the turn itself — the reducer keeps `unheard`
 * from the abandon reason and the transcript marks that block
 * (`conversation-transcript.tsx`, `web.translate.turnUnheard`).
 *
 * That marker is now the only disclosure. A paragraph under the speed control
 * warned about the cost before anything had been lost; it was removed as
 * redundant, since the marker tells the truth at the moment it becomes true, on
 * the row it belongs to.
 *
 * The limit of it, worth knowing before trusting it: a turn dropped before its
 * text ever arrived has no row to mark, so the marker undercounts rather than
 * overcounts.
 */
export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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

/**
 * Whether a conversation's turns may be in either language of the pair.
 *
 * `two-way` asks the server to decide each turn's language; `one-way` declares
 * every turn to be in the source, or leaves it to auto-detection. The choice is
 * the reader's because the server cannot make it well: a Vietnamese turn under
 * 1.3 s is heard as Vietnamese only about two times in three (`benchmarks/lid`),
 * so a conversation in which nobody speaks the other language still loses its
 * short turns to it.
 *
 * Not a stored setting: each mode is its own page (`/translate/one-way` and
 * `/translate/two-way`), so the route the reader opened IS the choice. An older build
 * stored it as `conversationMode`; the whitelist strips that key, and it is read
 * once, raw, to seed {@link TranslateSettings.twoWayPair}.
 */
export type ConversationMode = 'one-way' | 'two-way';
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
const DEFAULT_TEXT_SIZE = 3;

/** The multiplier for a step, for the one place that writes `--reading-scale`. */
export function textSizeScale(step: number): number {
  return TEXT_SIZE_SCALES[snapTextSize(step) - 1]!;
}

/**
 * A chosen voice token, kept inside its language's setup.
 *
 * Per language because the two engines address voices by disjoint vocabularies —
 * an integer speaker id for English, a preset name for Vietnamese — so a token
 * kept once would survive a pair change and reach an engine that cannot mean
 * anything by it.
 *
 * Bounded but otherwise opaque, and deliberately never an enum: which voices
 * exist is a property of whichever backend is running, discovered at runtime.
 */
const voiceTokenSchema = z.string().max(VOICE_TOKEN_MAX).optional().catch(undefined);

/**
 * How one language is spoken — everything about the voice a reader can set, kept
 * per language.
 *
 * Per language rather than once, because the two sides of a conversation are
 * heard by different people and spoken by different engines: one reader wants to
 * hear English and not Vietnamese, and a rate the English engine honours the
 * Vietnamese one ignores. Keyed by language rather than by page, so the English
 * voice set on `/translate/two-way` is the one `/translate/one-way` into English
 * speaks with, and `/settings/defaults` edits the same thing.
 */
export interface LanguageVoiceSetup {
  /** Whether translations into this language are spoken at all. */
  speak: boolean;
  /** Which gender's default speaks when no voice is named. */
  gender: VoiceGender;
  /**
   * Speaking rate. Whether it does anything is a property of the engine that
   * speaks this language, read from its voice catalog (`speedAdjustable`).
   */
  speed: number;
  /** An opaque token from this language's catalog; absent is the gender default. */
  voice?: string;
  /** Playback gain, 0..1, in this tab. Never sent: it is a property of the listener. */
  volume: number;
}

export const DEFAULT_LANGUAGE_VOICE: LanguageVoiceSetup = Object.freeze({
  speak: true,
  gender: DEFAULT_VOICE_GENDER,
  speed: 1,
  volume: 1,
});

/** One {@link LanguageVoiceSetup} per registry language. */
export type VoiceByLanguage = LanguageTable<LanguageVoiceSetup>;

export interface TranslateSettings {
  /**
   * Which languages a new conversation starts in, source first. The source may
   * be `'detect'` — see {@link canAutoDetectInto} for when it is offered.
   */
  languagePair: SessionLanguagePair;
  /**
   * The pair `/translate/two-way` starts in. Its own field rather than a mode applied
   * to {@link languagePair}, because the one-way pair may be `'detect'` and a
   * two-way conversation has no such thing: sharing one pair would let a choice
   * made on one page open the other in a state it cannot run. Always a pair
   * {@link canRunTwoWay} accepts — see `storedTwoWayPair`.
   */
  twoWayPair: LanguagePair;
  /** How each language is spoken — see {@link LanguageVoiceSetup}. */
  voiceByLanguage: VoiceByLanguage;
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
  /**
   * Which saved AI Context a new conversation starts with, by its client-minted
   * id, or null for none.
   *
   * The ID, never the content. The context itself lives on the server, because a
   * glossary is authored work rather than a toggle, and because the extension
   * cannot read this store at all — it holds its own settings in
   * `chrome.storage` and reaches the same library over HTTP.
   *
   * Bounded here and never validated against the list, exactly as the voice
   * token above is: which contexts exist is fetched over HTTP and is not
   * knowable to a synchronous read. A stale id is reconciled at the point of
   * use, where the list has resolved, and reads as "no context".
   */
  contextId: string | null;
  /** How the transcript looks on the page. See `reading-appearance.ts`. */
  appearance: ReadingAppearance;
  /** How it looks in fullscreen and in the floating caption window. */
  stage: StageAppearance;
  /** Browser mic processing, applied at the next start. See `MicProcessing`. */
  micProcessing: MicProcessing;
}

/**
 * The stage's look: its own appearance and its own text size, or the page's.
 *
 * Separate because the stage is read differently — across a room, or in a small
 * window floating over a video — and the size and ground that suit a desk are the
 * wrong ones there. `followPage` exists for the reader who wants one look
 * everywhere; it ignores the stored stage values rather than overwriting them, so
 * switching it off returns what was set before.
 */
export interface StageAppearance extends ReadingAppearance {
  followPage: boolean;
  /** 1..10 into {@link TEXT_SIZE_SCALES}, like the page's. */
  textSize: number;
}

/**
 * Captions, not a page: black ground, bold translation, text two steps past the
 * middle. The black ground forces the dark scheme on what it paints, so the
 * default inks come out light without being set.
 */
export const DEFAULT_STAGE_APPEARANCE: StageAppearance = Object.freeze({
  ...DEFAULT_READING_APPEARANCE,
  background: 'black',
  targetWeight: 'bold',
  followPage: false,
  textSize: 6,
});

/** What the stage draws with, after `followPage`. */
export function effectiveStageAppearance(settings: TranslateSettings): {
  appearance: ReadingAppearance;
  textSize: number;
} {
  if (settings.stage.followPage) {
    return { appearance: settings.appearance, textSize: settings.textSize };
  }
  return { appearance: pickReadingAppearance(settings.stage), textSize: settings.stage.textSize };
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
  languagePair: DEFAULT_LANGUAGE_PAIR,
  twoWayPair: DEFAULT_LANGUAGE_PAIR,
  voiceByLanguage: Object.freeze(
    Object.fromEntries(LANGUAGE_CODES.map((code) => [code, DEFAULT_LANGUAGE_VOICE])),
  ) as VoiceByLanguage,
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
  contextId: null,
  appearance: DEFAULT_READING_APPEARANCE,
  stage: DEFAULT_STAGE_APPEARANCE,
  micProcessing: DEFAULT_MIC_PROCESSING,
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
const SETTINGS_VERSION = 4;

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
 * one merged stream, so a layout that still reaches this step MAPS rather than
 * being dropped.
 *
 * Note the ordering: a pre-v2 blob has its layout deleted before this step reads
 * it, so it maps nothing and takes the defaults. That is correct, and it is why
 * these are steps rather than one branch.
 *
 * **Which is also why the mapping fires for almost nobody, and that is not a
 * mistake to correct.** The stamp itself is new, so an installed store carries no
 * `version` and reads as 0 — v2 deletes its layout, and this step finds nothing.
 * The only blobs it can map are the ones stamped `2` while this pair of steps was
 * being written, in the browsers that ran that build. The branch stays because the
 * alternative is a v3 that silently assumes the drop always won: a store arriving
 * with a stamp of 2 is not hypothetical to the person holding one, and stepwise is
 * what lets the next field be added without re-reading this decision.
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

  if (version < 4) {
    // One voice for every language becomes one per language. Each language
    // starts as a copy of the single setup the reader had, so nothing they chose
    // is lost and nothing changes until they change it; the token was already
    // kept per language and moves into its language's setup.
    const tokens =
      next.voice && typeof next.voice === 'object' ? (next.voice as Record<string, unknown>) : {};
    next.voiceByLanguage = Object.fromEntries(
      LANGUAGE_CODES.map((code) => [
        code,
        {
          speak: next.voiceOutput,
          gender: next.voiceGender,
          speed: next.speed,
          voice: tokens[code],
          volume: next.volume,
        },
      ]),
    );
    for (const field of ['voiceOutput', 'voiceGender', 'speed', 'voice', 'volume']) {
      delete next[field];
    }
  }

  next.version = SETTINGS_VERSION;
  return next;
}

/**
 * One language's setup, read field by field: an unreadable rate keeps the
 * language's speak flag, voice and volume. A token longer than the cap is
 * dropped rather than truncated — half a token is not a shorter token, it is a
 * different one, and it would be refused downstream anyway.
 */
const storedLanguageVoiceSchema = z
  .object({
    speak: z.boolean().catch(DEFAULT_LANGUAGE_VOICE.speak),
    gender: voiceGenderSchema.catch(DEFAULT_LANGUAGE_VOICE.gender),
    speed: z.number().catch(DEFAULT_LANGUAGE_VOICE.speed).transform(snapSpeed),
    voice: voiceTokenSchema,
    volume: z
      .number()
      .catch(DEFAULT_LANGUAGE_VOICE.volume)
      .transform((value) => clamp(value, 0, 1)),
  })
  .catch(DEFAULT_LANGUAGE_VOICE)
  // An absent token is left out rather than kept as `voice: undefined`, so a
  // setup reads the same whether it was stored or defaulted.
  .transform(({ voice, ...rest }) => (voice === undefined ? rest : { ...rest, voice }));

/** Per language, each on its own — one language's bad value never resets another's. */
const storedVoiceByLanguageSchema = z.object(
  Object.fromEntries(
    LANGUAGE_CODES.map((code) => [code, storedLanguageVoiceSchema]),
  ) as LanguageTable<typeof storedLanguageVoiceSchema>,
);

/**
 * The whitelist.
 *
 * Every field falls back independently: one unreadable value must not discard the
 * other five. `catch` per field rather than per object is what buys that — a
 * single object-level catch would reset a user's whole panel because one number
 * was out of range.
 */
const storedSettingsSchema = z.object({
  voiceByLanguage: storedVoiceByLanguageSchema.catch(DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage),
  displayMode: displayModeSchema.catch(DEFAULT_TRANSLATE_SETTINGS.displayMode),
  paneLayout: paneLayoutSchema.catch(DEFAULT_TRANSLATE_SETTINGS.paneLayout),
  speakerLabels: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.speakerLabels),
  translationOnly: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.translationOnly),
  freeScroll: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.freeScroll),
  // Snapped, not merely bounded, for the same reason as the speed above: a value
  // inside the range but off the grid leaves the slider between two stops.
  textSize: z.number().catch(DEFAULT_TRANSLATE_SETTINGS.textSize).transform(snapTextSize),
  // Bounded, never checked against the list, and dropped rather than truncated
  // for the same reason the voice token is: half an id is not a shorter id.
  contextId: z.string().max(64).nullable().catch(DEFAULT_TRANSLATE_SETTINGS.contextId),
  // Per field inside, and the whole object only when it is not an object at all —
  // a stored appearance missing one field written by a newer build keeps the rest.
  appearance: z
    .object(readingAppearanceShape(DEFAULT_READING_APPEARANCE))
    .catch(DEFAULT_READING_APPEARANCE),
  stage: z
    .object({
      ...readingAppearanceShape(DEFAULT_STAGE_APPEARANCE),
      followPage: z.boolean().catch(DEFAULT_STAGE_APPEARANCE.followPage),
      textSize: z.number().catch(DEFAULT_STAGE_APPEARANCE.textSize).transform(snapTextSize),
    })
    .catch(DEFAULT_STAGE_APPEARANCE),
  // Per field, like the appearance: one unreadable boolean keeps the other two.
  micProcessing: z
    .object({
      echoCancellation: z.boolean().catch(DEFAULT_MIC_PROCESSING.echoCancellation),
      noiseSuppression: z.boolean().catch(DEFAULT_MIC_PROCESSING.noiseSuppression),
      autoGainControl: z.boolean().catch(DEFAULT_MIC_PROCESSING.autoGainControl),
    })
    .catch(DEFAULT_MIC_PROCESSING),
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
      languagePair: storedLanguagePair(stored),
      twoWayPair: storedTwoWayPair(stored),
      voiceByLanguage: parsed.voiceByLanguage,
      displayMode: parsed.displayMode,
      paneLayout: parsed.paneLayout,
      speakerLabels: parsed.speakerLabels,
      translationOnly: parsed.translationOnly,
      freeScroll: parsed.freeScroll,
      textSize: parsed.textSize,
      contextId: parsed.contextId,
      appearance: parsed.appearance,
      stage: parsed.stage,
      micProcessing: parsed.micProcessing,
    };
    return settings;
  } catch {
    // Unparseable JSON, storage disabled by policy, or a private window that
    // throws on access. Defaults are always a state the UI can render.
    return DEFAULT_TRANSLATE_SETTINGS;
  }
}

/**
 * The stored pair, read off the raw blob rather than through the whitelist.
 *
 * Not a `.catch(default)` field like its neighbours, because an absent or
 * unreadable `languagePair` still has one more place to come from: builds before
 * it stored a `'vi_to_en'`-style `direction` string. Parsing that is
 * `languagePairFromStoredDirection`'s job alone, so the old format has one
 * reader; the next save writes `languagePair` and the string is not read again.
 */
function storedLanguagePair(stored: Record<string, unknown>): SessionLanguagePair {
  const pair = sessionLanguagePairSchema.safeParse(stored.languagePair);
  if (pair.success) return representablePair(pair.data);
  return languagePairFromStoredDirection(stored.direction) ?? DEFAULT_LANGUAGE_PAIR;
}

/**
 * The stored two-way pair, falling back to what an older build implied.
 *
 * Read raw, like {@link storedLanguagePair}, because an absent value has a
 * second source: before the two modes were separate pages, one stored pair
 * served both, with `conversationMode` saying which. A named pair that could
 * run both ways and was not set to one-way is exactly the pair that reader was
 * conversing in, so it carries over; anything else — `'detect'`, a pair the
 * shipped identification cannot tell apart, an explicit one-way — says nothing
 * about a two-way conversation, and the default stands.
 *
 * A stored pair that cannot run two-way is refused for the same reason the
 * picker refuses it: a state the page cannot start in is a state the reader
 * cannot leave.
 */
function storedTwoWayPair(stored: Record<string, unknown>): LanguagePair {
  const own = languagePairSchema.safeParse(stored.twoWayPair);
  if (own.success) return canRunTwoWay(own.data) ? own.data : DEFAULT_LANGUAGE_PAIR;

  const shared = languagePairSchema.safeParse(stored.languagePair);
  if (shared.success && stored.conversationMode !== 'one-way' && canRunTwoWay(shared.data)) {
    return shared.data;
  }
  return DEFAULT_LANGUAGE_PAIR;
}

/**
 * Whether "detect it" is offered for a conversation translated into `target`.
 *
 * Two conditions, and the second is the one `canIdentify` alone does not ask:
 * the turns must be identifiable among each other, AND a turn said in the
 * target itself must be recognisable as such — that is what lets it stay
 * transcript-only instead of being forced into another language and
 * "translated" back. A target outside the identifiable set fails it.
 */
export function canAutoDetectInto(target: LanguageCode): boolean {
  return (
    canIdentify({ source: AUTO_DETECT, target }, false) && IDENTIFIABLE_LANGUAGES.includes(target)
  );
}

/**
 * Whether a conversation in `pair` can be run two-way at all: a named source,
 * and two languages the shipped identification can tell apart. Where it cannot,
 * the one-way / two-way choice is not offered.
 */
export function canRunTwoWay(pair: SessionLanguagePair): boolean {
  return pair.source !== AUTO_DETECT && canIdentify(pair, true);
}

/**
 * Whether a conversation started in `pair` asks the server to run it two-way.
 *
 * A request, which the server may answer with less — the screen follows the
 * mode `server.session.ready` reports, never this. Only `/translate/two-way` asks, and
 * even there a pair the shipped identification cannot tell apart stays
 * declared without asking.
 */
export function asksTwoWay(pair: SessionLanguagePair, mode: ConversationMode): boolean {
  return mode === 'two-way' && canRunTwoWay(pair);
}

/** The pair a page in `mode` shows and starts in. */
export function pairFor(settings: TranslateSettings, mode: ConversationMode): SessionLanguagePair {
  return mode === 'two-way' ? settings.twoWayPair : settings.languagePair;
}

/**
 * The settings change that stores `pair` as `mode`'s pair.
 *
 * Two-way never holds `'detect'` and never a pair it cannot run; a pick that
 * would produce one is dropped rather than stored, since the two-way picker
 * offers neither and anything else reaching here is a caller's mistake.
 */
export function pairPatchFor(
  mode: ConversationMode,
  pair: SessionLanguagePair,
): Partial<TranslateSettings> {
  if (mode === 'one-way') return { languagePair: representablePair(pair) };
  if (pair.source === AUTO_DETECT || !canRunTwoWay(pair)) return {};
  return { twoWayPair: { source: pair.source, target: pair.target } };
}

/**
 * The pair as this build can offer it: "detect" dropped, for the first other
 * registry language, where {@link canAutoDetectInto} refuses the target.
 *
 * Applied on read AND on every pick, because a picked target can be the one
 * that rules detection out — and a stored value the current UI cannot show is a
 * state the reader cannot leave.
 */
export function representablePair(pair: SessionLanguagePair): SessionLanguagePair {
  if (pair.source !== AUTO_DETECT || canAutoDetectInto(pair.target)) return pair;
  const source =
    LANGUAGE_CODES.find((code) => code !== pair.target) ?? DEFAULT_LANGUAGE_PAIR.source;
  return { source, target: pair.target };
}

/**
 * The languages a conversation started from `pair` on `mode`'s page may speak,
 * the one a declared turn speaks first: both sides of a two-way pair, the
 * target of anything else. Auto-detect speaks only its target.
 */
export function spokenLanguagesOf(
  pair: SessionLanguagePair,
  mode: ConversationMode,
): LanguageCode[] {
  return pair.source !== AUTO_DETECT && asksTwoWay(pair, mode)
    ? [pair.target, pair.source]
    : [pair.target];
}

/** One language's setup. */
export function languageVoice(
  settings: Pick<TranslateSettings, 'voiceByLanguage'>,
  language: LanguageCode,
): LanguageVoiceSetup {
  return settings.voiceByLanguage[language];
}

/**
 * The patch that changes one language's setup and leaves every other alone.
 *
 * Builds new objects all the way down: the defaults are frozen, and a setup
 * edited in place would edit them for every later fallback on the page.
 */
export function languageVoicePatch(
  settings: Pick<TranslateSettings, 'voiceByLanguage'>,
  language: LanguageCode,
  patch: Partial<LanguageVoiceSetup>,
): Pick<TranslateSettings, 'voiceByLanguage'> {
  const next = { ...settings.voiceByLanguage[language], ...patch };
  // `voice: undefined` in a patch means "the gender default": dropped, not kept.
  if (next.voice === undefined) delete next.voice;
  return { voiceByLanguage: { ...settings.voiceByLanguage, [language]: next } };
}

/** The patch that applies `patch` to every language's setup at once. */
export function everyLanguageVoicePatch(
  settings: Pick<TranslateSettings, 'voiceByLanguage'>,
  patch: Partial<LanguageVoiceSetup>,
): Pick<TranslateSettings, 'voiceByLanguage'> {
  let next = settings;
  for (const language of LANGUAGE_CODES) next = languageVoicePatch(next, language, patch);
  return { voiceByLanguage: next.voiceByLanguage };
}

/**
 * The voice fields of a start that may speak `languages`, the one it speaks
 * first leading.
 *
 * Both shapes, on purpose. `voiceByLanguage` is what this build means; the flat
 * fields, read off the first language, are what an API older than that field
 * still understands — so a web deploy that lands before its API speaks the
 * primary language as before rather than with every default.
 */
export function sessionVoiceOptions(
  settings: Pick<TranslateSettings, 'voiceByLanguage'>,
  languages: readonly LanguageCode[],
): Pick<SessionOptions, 'voiceGender' | 'voiceOutput' | 'speed' | 'voice' | 'voiceByLanguage'> {
  const primary = settings.voiceByLanguage[languages[0] ?? DEFAULT_LANGUAGE_PAIR.target];
  return {
    voiceGender: primary.gender,
    voiceOutput: primary.speak,
    speed: primary.speed,
    ...(primary.voice ? { voice: primary.voice } : {}),
    voiceByLanguage: Object.fromEntries(
      languages.map((language) => {
        const { speak, speed, gender, voice } = settings.voiceByLanguage[language];
        return [language, { speak, speed, gender, ...(voice ? { voice } : {}) }];
      }),
    ),
  };
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
