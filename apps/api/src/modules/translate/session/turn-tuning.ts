import type { LanguageTable } from '@chatofy/types';

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
 * Do not go below 12 for a language written in letters. Below it a request
 * lands every couple of syllables and the 500-per-day-per-model allowance is
 * gone in minutes. Per-word output is reachable by raising quota — more
 * projects, more keys — not by lowering this number.
 *
 * Per language, because a character is not the same amount of speech in every
 * script: a Han character is a whole syllable. MEASURED on 8 s turns cut from
 * continuous speech (`benchmarks/stt/results/r13-zh-commit`, replayed through
 * this trigger): at 15 for both, Chinese fired 15.8 times per minute of audio
 * against Vietnamese's 35.2 — 0.45×, so zh provisional text trailed the
 * speaker for more than twice as long. The rule fixed before that run gives zh
 * max(4, round(15 × 15.8 / 35.2)) = 7, which brings its request rate back to
 * Vietnamese's rather than above it; the floor above is about that RATE, and
 * 7 Han characters keep it.
 */
export const LIVE_TRANSLATION_COMMIT_CHARS: LanguageTable<number> = {
  vi: 15,
  en: 15,
  zh: 7,
};

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

/**
 * When a two-way turn's live preview settles on a language: the sidecar's
 * confidence in its guess, and how much speech that guess heard (its
 * `lidSpeechMs`). Below either, partials show text but no language, and the
 * live translation waits.
 *
 * Chosen on the language-identification bake-off (`benchmarks/lid`, run
 * `conv-r4-all`, Whisper base with a 5 s encoder floor), scored
 * leave-one-group-out on public conversational speech and its re-recordings.
 * The first tuning grid stepped from 900 ms straight to 1500 ms and picked
 * 0.6 / 1500; on the same held-out folds 0.8 / 1300 overrules fewer locks
 * (5.7% against 6.2% of vi↔en turns, bar 10%) and locks right more often
 * (91.8% against 91.0%), and needs 200 ms less speech.
 *
 * Replayed through the API on the same 491 turns (`replay_sessions.mjs`,
 * timed from speech onset, which is what the bar means): label p50 1697 →
 * 1559 ms, p95 3409 → 3320 ms (bar 3.5 s), finals overruling the lock 7.1% →
 * 5.9%, final accuracy unchanged.
 */
export const LID_LOCK_CONFIDENCE = 0.8;
export const LID_LOCK_MIN_SPEECH_MS = 1300;

/**
 * Below this confidence a final is not believed, and the turn takes the
 * previous turn's language — or the source, for the first turn. Same run as
 * above: vi↔en turns under 1.5 s were 95.2% right before any fallback.
 */
export const LID_UNCERTAIN_BELOW = 0.6;

/**
 * A confident turn: one this sure (no prior applied) in the language that is
 * not the source is evidence the other side is talking, which ends the source
 * prior for the rest of the session.
 */
export const LID_CONFIDENT_AT = 0.9;

/**
 * Log-odds added to the source while a session has shown only one side.
 *
 * Zero because that is what the bake-off's tuning chose from its grid. Kept
 * as a constant rather than removed so a re-tuned bonus is one edit; with it
 * at zero, leaning towards the source is the fallback's job (an uncertain
 * first turn takes the source).
 */
export const LID_SOURCE_PRIOR_LOGODDS = 0;
