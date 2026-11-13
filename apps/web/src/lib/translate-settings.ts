/**
 * What the translator remembers, and how it is read.
 *
 * The settings live in the ACCOUNT now — one preferences document per user, shared
 * by web, mobile and the extension (`@chatofy/types` `userPreferencesSchema`). This
 * file owns the web's view of it: the `TranslateSettings` shape every screen reads,
 * and the whitelist each stored field passes through on its way in. The mapping to
 * and from the document is `translate-settings-preferences.ts`.
 *
 * Modelled on `apps/extension/src/settings.ts`: merge what was stored over the
 * defaults, then WHITELIST each field rather than trusting what came back. A value
 * written by an older or newer build is not hostile, but it is unknown, and a setting
 * the current UI cannot represent is a state the user cannot leave — the extension hit
 * exactly that with a stored mode whose control had been removed.
 *
 * One field stays on the device: `micProcessing`, because a microphone chain is a
 * property of a machine's hardware, not of a person (`lib/mic-processing-store.ts`).
 */
import { z } from 'zod';
import {
  AUTO_DETECT,
  DEFAULT_LANGUAGE_PAIR,
  DEFAULT_MIC_PROCESSING,
  DEFAULT_VOICE_GENDER,
  IDENTIFIABLE_LANGUAGES,
  LANGUAGE_CODES,
  canIdentify,
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
 * Which end of the conversation a live view starts from.
 *
 * `oldest-first` reads like a chat: the newest turn and the line being spoken at
 * the bottom. `newest-first` turns it over for a reader who glances at the top of
 * the screen — the line being spoken first, then turns newest to oldest. Live
 * views only; `/history` is a record, read from its beginning.
 */
const transcriptOrderSchema = z.enum(['oldest-first', 'newest-first']);
export type TranscriptOrder = z.infer<typeof transcriptOrderSchema>;

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
 * speaks with, and Settings › Translation edits the same thing.
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
  /** Which end of the conversation a live view starts from — see {@link TranscriptOrder}. */
  transcriptOrder: TranscriptOrder;
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
 * `useTranslateSettings` hands this back until the preferences are ready, and `set`
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
  // Oldest first: the reading every existing reader already has.
  transcriptOrder: 'oldest-first',
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

/**
 * Per language, each on its own — one language's bad value never resets another's.
 *
 * The account document holds each language's setup as a PARTIAL (a client that
 * only knows some fields round-trips the rest), so the reader lays every stored
 * setup over {@link DEFAULT_LANGUAGE_VOICE} before this runs.
 */
export const storedVoiceByLanguageSchema = z
  .object(
    Object.fromEntries(
      LANGUAGE_CODES.map((code) => [code, storedLanguageVoiceSchema]),
    ) as LanguageTable<typeof storedLanguageVoiceSchema>,
  )
  .catch(DEFAULT_TRANSLATE_SETTINGS.voiceByLanguage);

/**
 * How the transcript reads: the fields the account document keeps under its
 * web-owned `reading` object.
 *
 * Named once so the read and the write agree on which fields travel there —
 * `translate-settings-preferences.ts` reads this list in both directions.
 */
export const READING_FIELDS = [
  'displayMode',
  'paneLayout',
  'speakerLabels',
  'translationOnly',
  'freeScroll',
  'transcriptOrder',
  'textSize',
  'appearance',
  'stage',
] as const satisfies readonly (keyof TranslateSettings)[];

export type ReadingSettings = Pick<TranslateSettings, (typeof READING_FIELDS)[number]>;

/**
 * The whitelist for `reading`.
 *
 * Every field falls back independently: one unreadable value must not discard the
 * others. `catch` per field rather than per object is what buys that — a
 * single object-level catch would reset a user's whole panel because one number
 * was out of range. Zod strips what it does not declare, so a field a newer build
 * added is dropped here rather than carried into every consumer.
 */
export const readingSettingsSchema = z.object({
  displayMode: displayModeSchema.catch(DEFAULT_TRANSLATE_SETTINGS.displayMode),
  paneLayout: paneLayoutSchema.catch(DEFAULT_TRANSLATE_SETTINGS.paneLayout),
  speakerLabels: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.speakerLabels),
  translationOnly: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.translationOnly),
  freeScroll: z.boolean().catch(DEFAULT_TRANSLATE_SETTINGS.freeScroll),
  transcriptOrder: transcriptOrderSchema.catch(DEFAULT_TRANSLATE_SETTINGS.transcriptOrder),
  // Snapped, not merely bounded, for the same reason as the speed above: a value
  // inside the range but off the grid leaves the slider between two stops.
  textSize: z.number().catch(DEFAULT_TRANSLATE_SETTINGS.textSize).transform(snapTextSize),
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
});

/** Per field, like the appearance: one unreadable boolean keeps the other two. */
const micProcessingSchema = z
  .object({
    echoCancellation: z.boolean().catch(DEFAULT_MIC_PROCESSING.echoCancellation),
    noiseSuppression: z.boolean().catch(DEFAULT_MIC_PROCESSING.noiseSuppression),
    autoGainControl: z.boolean().catch(DEFAULT_MIC_PROCESSING.autoGainControl),
  })
  .catch(DEFAULT_MIC_PROCESSING);

/** A stored mic chain, whitelisted; anything unreadable is the default chain. */
export function parseMicProcessing(raw: unknown): MicProcessing {
  return micProcessingSchema.parse(raw ?? DEFAULT_MIC_PROCESSING);
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
