/**
 * How many rate limits this process has been told about, per model.
 *
 * Counted as well as logged so acceptance can measure it. A log line is
 * something a person reads afterwards; a number is something a gate can fail
 * on, and an earlier plan tried to gate on a string that was never written to
 * the file it grepped — so that gate passed by construction.
 *
 * **Per model, because that is the unit Google meters.** The rejection body
 * names it: `GenerateRequestsPerMinutePerProjectPerModel`. A single total would
 * make a turn metric about live-translation headroom rise when a minutes pass
 * was throttled on `gemini-3.5-flash`, which spends a different bucket
 * entirely. It must still rise when a minutes pass is throttled on
 * `gemini-3.5-flash-lite`, because that IS the live translator's bucket — so
 * the split is by model and not by which provider hit the limit.
 *
 * Observation only. The response to a rate limit belongs to the provider, which
 * already rotates keys and cools the pair that answered; a second reaction here
 * would punish one event twice.
 *
 * Module state rather than an injected service, and it lives at the module root
 * rather than under `providers/` so that the session layer can read it without
 * depending on the layer that writes it.
 */
const cooldownsByModel = new Map<string, number>();

/** Records one rate limit. Monotonic, never reset. */
export const recordQuotaCooldown = (model: string): void => {
  cooldownsByModel.set(model, (cooldownsByModel.get(model) ?? 0) + 1);
};

/** How many rate limits this process has seen on one model. */
export const quotaCooldownCount = (model: string): number =>
  cooldownsByModel.get(model) ?? 0;
