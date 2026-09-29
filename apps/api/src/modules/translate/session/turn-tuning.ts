/**
 * Tuning values the turn pipeline runs with. They were env keys until every
 * deployment set the same numbers; a change is now a reviewed edit here rather
 * than a line in a file that lives outside the repository.
 */

/**
 * Silero speech floor, in ms, the API asks the local sidecar to apply on
 * every recognition whose text can end up in a saved turn: the final, the
 * speculation, the whole-turn source beside a split, and each split piece.
 * Below it `/transcribe` answers an empty transcript without decoding, and
 * the turn ends quietly as `no_speech` instead of the ordinary
 * "no speech detected" banner — see `pipeline-translator.service.ts`'s
 * `NoSpeechDetectedException`.
 *
 * 300 was measured in `docs/development-journey.md` (29/09/2026 section). The
 * live partial path does not read this — `live-preview.ts`'s re-reads stay
 * ungated regardless of this value (see `docs/system-architecture.md`).
 *
 * Rolling the gate back is a revert of this constant, not a setting.
 */
export const STT_MIN_SPEECH_MS = 300;

/**
 * How many newly settled characters are worth a mid-sentence translation.
 *
 * The trigger fires on speech PROGRESS rather than on elapsed time, so this is
 * the unit that decides how finely a translation follows a sentence. Smaller
 * is more responsive and costs proportionally more requests.
 *
 * 15 is a phrase, roughly three Vietnamese syllables, and it is a deliberate
 * choice rather than a default nobody examined. At the measured settling rate
 * of 11.5 characters per second of speech it works out near 28 requests per
 * minute at conversational density — comfortably inside the per-minute
 * ceiling, and around a hundred minutes of conversation against the daily one.
 *
 * Do not go below 12. Below it a request lands every couple of syllables
 * and the 500-per-day-per-model allowance is gone in minutes. Per-word output
 * is reachable by raising quota — more projects, more keys — not by lowering
 * this number.
 */
export const LIVE_TRANSLATION_COMMIT_CHARS = 15;

/**
 * Ceiling on MID-SENTENCE translation requests per minute, per user.
 *
 * Derived, not picked. Google meters per project per model, and the six keys
 * in rotation draw on six separate buckets, so `gemini-3.5-flash-lite` affords
 * 6 x 15 = 90 per minute. The end-of-turn translation starts on that same
 * model, so roughly 7 per minute of that is already spoken for at the measured
 * turn rate, leaving about 83; this keeps 80% of what is left.
 *
 * There is deliberately NO daily ceiling here. The 500-per-day-per-model
 * allowance is real, but an in-process counter loses its count on restart and
 * keys its "day" to this machine's clock rather than Google's reset — it would
 * report safe while unsafe, which is worse than not checking. Daily spend is
 * measured at acceptance and decided on real numbers instead.
 */
export const LIVE_TRANSLATION_RPM = 66;
