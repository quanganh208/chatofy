// Which translation backend a client drives. Schema-first, like every other
// domain enum here.
import { z } from 'zod';
import type { LanguageTable } from './languages.js';

/**
 * The two ways this system can translate speech.
 *
 * `cascade` runs STT → translate → TTS and thinks in turns: it waits for an
 * utterance to end, then answers it. `live` holds one upstream speech-to-speech
 * session that never waits — it starts speaking a few seconds behind the
 * speaker and has no turn boundaries at all.
 *
 * CANONICAL mode selector. Both travel `/ws/translate` and are told apart by
 * which start message the client sends, so this is purely a CLIENT choice —
 * there is no server setting to match it against, and nothing to deploy
 * differently. It lives here rather than in either app because the web page and
 * the extension both offer the choice, and two spellings of one product concept
 * is how they drift.
 */
export const translateModeSchema = z.enum(['cascade', 'live']);
export type TranslateMode = z.infer<typeof translateModeSchema>;

/**
 * Applied wherever the caller may leave the mode unstated.
 *
 * The cascade: it is the measured path, it carries turn boundaries every
 * consumer of a transcript is built on, and it is the one that works without
 * headphones.
 */
export const DEFAULT_TRANSLATE_MODE: TranslateMode = 'cascade';

/**
 * Which registry languages the `live` mode will translate from or into.
 *
 * Chinese is refused there by decision, not by accident: the zh language work
 * validated the cascade (Paraformer, DeepSeek, Kokoro) and never Gemini Live,
 * so the gateway answers a zh pair with `unsupported_language_pair` and the
 * extension's picker offers no zh pair in live mode. One table, read by both,
 * so they cannot disagree.
 */
export const LIVE_LANGUAGES: LanguageTable<boolean> = {
  vi: true,
  en: true,
  zh: false,
};
