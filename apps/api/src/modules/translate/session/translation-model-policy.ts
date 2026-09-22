/**
 * Which models a live turn is allowed to spend, and how many guesses it may
 * make. Gathered here because these are quota decisions rather than mechanics,
 * and every one of them was settled by measurement — the reasoning travels with
 * the constants.
 *
 * **Every model id below is a Gemini id, and that is a limitation rather than a
 * detail.** `AI_TRANSLATION_PROVIDER` can select an OpenAI-compatible host
 * instead, and these lists are handed to it as `TranslationRequest.models`,
 * which the interface says overrides whatever the provider was configured with.
 * Taken literally that sends `gemini-3.5-flash-lite` to DeepSeek, which answers
 * 400 on every turn — measured, on a benchmark run where all ten turns failed
 * that way.
 *
 * What stops it today is a guard on the provider's side:
 * `OpenAiCompatibleTranslationProvider` intersects a requested ladder with the
 * models it actually serves and falls back to its own when the two do not
 * overlap. So a non-Gemini backend silently ignores everything here and runs on
 * one model, which costs it the one thing these lists exist to buy — the split
 * that keeps speculative traffic off the model the endpoint depends on.
 *
 * That split is a FREE-TIER remedy, so ignoring it is not obviously wrong: the
 * hosts behind that variable meter spend rather than requests and publish a
 * concurrency limit instead of a per-minute ceiling, which is the wall this
 * file works around. If one of them ever ships as the default, the question to
 * answer first is whether it has a per-minute ceiling at all — and only then
 * whether it needs a ladder of its own here.
 */

/**
 * Guesses one turn may spend.
 *
 * Each is a translation request against a per-model per-minute ceiling, so this
 * is a spend limit, not a correctness one. Four covers a sentence with three
 * internal pauses, which is already a long conversational turn; past that the
 * turn keeps working and simply stops guessing, falling back to translating
 * once at the end.
 */
export const MAX_SPECULATIONS_PER_TURN = 4;

/**
 * Translation models a live turn may use, fastest first.
 *
 * Deliberately shorter than the Gemini provider's own ladder, which ends in a
 * model measured at 6.9s and observed here at 10s and 18s. That model is a reasonable
 * last resort for `POST /translate`, where a slow answer still beats none. In a
 * conversation it is not an answer at all — the speaker has moved on. A live
 * turn would rather fail and say so.
 *
 * Guesses and final translations are given different ladders on purpose. The
 * two models were measured at the same speed, so leading with either costs
 * nothing,
 * and the free tier meters per minute PER MODEL: keeping speculative traffic
 * off the model the endpoint depends on stops a talkative turn from spending
 * the quota its own ending needs. Measured before this split: speculation
 * pushed the shared ladder past its ceiling and two turns fell through to the
 * slow model.
 *
 * Typed as `string[]` rather than a readonly tuple because the pipeline takes
 * `models?: string[]`; `as const` here would fail at every call site.
 */
export const FINAL_MODELS: string[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];
export const SPECULATION_MODELS: string[] = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
];

/**
 * Model for translating a sentence that is still being spoken.
 *
 * One model and no fallback: a provisional translation is the most disposable
 * request this system makes, so a rate limit should cost the guess and nothing
 * else, rather than walk a ladder into the quota the speaker's actual answer
 * needs.
 *
 * That "nothing else" is now qualified, and knowingly so. Quota is metered per
 * project, so a key pool spreads a throttled request across projects: a
 * provisional translation rejected under one key is retried under the next on
 * the SAME model, which is also the model `FINAL_MODELS` leads with. The
 * isolation this constant buys is therefore partial once `GEMINI_API_KEY`
 * holds more than one key. Left as is deliberately — the measurements below
 * were taken against a single key, where the ceiling was 15/min in total
 * rather than 15/min per project, so the contention they found may simply not
 * arise at the wider ceiling. Worth re-measuring with `TURN_METRICS_PATH`
 * before adding machinery to restore it.
 *
 * Which model is the interesting part, and it follows from where the load
 * actually landed. Guesses lead with the other one, and because three turns in
 * four now reuse a guess, the endpoint itself rarely calls at all — so this
 * model is the idle one. Sending provisional work to the busy model instead was
 * measured: it clustered with the guesses inside the same turn, drew seven rate
 * limits over thirty-two turns, and one request came back after fifteen
 * seconds. The totals barely moved; the bunching was what hurt.
 */
export const LIVE_TRANSLATION_MODELS: string[] = ['gemini-3.5-flash-lite'];
