---
phase: 3
title: 'Cost knobs, default off'
status: pending
priority: P1
effort: '1.5d'
dependencies: [2]
---

# Phase 03: Cost knobs, default off

## Goal

Each cut whose gate the baseline meets exists as an env knob whose **default equals today's
behavior**. It is unit-tested and ready to be switched on for a replay arm in Phase 04.

## Context to read first

- The Phase 02 baseline report `plans/reports/benchmark-*-call-budget-baseline.md`. **Every gate below reads its numbers.**
- `apps/api/src/modules/translate/session/turn-speculation.ts` (whole file, 66 lines).
- `apps/api/src/modules/translate/session/turn-session.ts` (~L135 `new TurnSpeculation()`, ~L230 constructor and `TurnSessionDeps`, ~L265 `new LiveTranslationTrigger(`).
- `apps/api/src/modules/translate/session/turn-tuning.ts` (`LIVE_TRANSLATION_COMMIT_CHARS` ~L54).
- `apps/api/src/modules/translate/services/translation-session.service.ts` (`speculate()` ~L607, `new TurnSession(` ~L450, constructor ~L244).
- `apps/api/src/modules/translate/services/pipeline-translator.service.ts` (`transcribeAndTranslate` ~L1082, the `correcting` block ~L1177).
- `apps/api/src/config/env.schema.ts` (pattern: `z.coerce.number().int()…default(…)`; enum knobs like other `on|off` keys).
- `apps/api/src/modules/auth/purpose-token.ts` ~L139 (pattern for `@Inject(ConfigService) config: ConfigService<Env, true>`).

## Gate table (decide BEFORE coding; copy the filled table into the PR body)

| Knob                             | Env key (default)                          | Implement only if the baseline shows                                                                                                                                      | Proposed arm value                                     |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| K1 max speculations              | `TRANSLATE_MAX_SPECULATIONS` (`4`)         | always implement (cheap)                                                                                                                                                  | smallest K where ≥ 95% of hit turns have hit index ≤ K |
| K2 no overlapping speculation    | `TRANSLATE_SPECULATION_OVERLAP` (`on`)     | wasted speculative calls ≥ 20% of all translate calls                                                                                                                     | `off`                                                  |
| K3 no correction on speculations | `TRANSLATE_SPECULATION_CORRECTIONS` (`on`) | (homophones + fusion) share ≥ 20% of calls AND accepted-and-not-late corrections ≤ 10% of their calls                                                                     | `off`                                                  |
| K4 fewer live previews           | `TRANSLATE_LIVE_COMMIT_SCALE` (`1`)        | live share ≥ 20% of calls                                                                                                                                                 | `2`                                                    |
| K5 per-turn prompt memo          | `TRANSLATE_PROMPT_MEMO` (`off`)            | duplicate-prompt share ≥ 10% of translate calls                                                                                                                           | `on`                                                   |
| Polish                           | —                                          | if polish ≥ 30% of billed tokens: **STOP and ask the user** (polish has a measured quality gain in `docs/architecture/ai-providers.md`; cutting it is a product decision) | —                                                      |

A knob whose gate is not met is **not implemented**. Write "skipped: <number> < <threshold>" in the PR body.

## Files to Create / Modify

- Create: `apps/api/src/modules/translate/session/translation-cost-policy.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/config/env.schema.ts` (+ `env.schema.spec.ts`)
- Modify: `apps/api/src/modules/translate/session/turn-speculation.ts` (+ spec)
- Modify: `apps/api/src/modules/translate/session/turn-session.ts`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` (+ the specs that construct it)
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts` (+ spec), only for K3 and K5
- Modify: `apps/api/.env.example` (document the keys, commented, with defaults)
- Modify: `prod.env.example` (one `# TRANSLATE_<KEY>=` line per new key: `#`, exactly one space, key, `=`; without it `scripts/check-prod-env.mjs` fails the deploy as soon as Phase 04 sets the key in `prod.env`)

## Tasks

### Task 3.1 — Env keys and the policy object

- Steps:
  1. In `env.schema.ts` add only the keys whose gate passed, with the defaults in the table (`TRANSLATE_MAX_SPECULATIONS: z.coerce.number().int().min(0).max(4).default(4)`, enums as `emptyStringAsUndefined(z.enum(['on','off']).default(…))` following `TRANSLATE_LIVE_MODE` ~L199, `TRANSLATE_LIVE_COMMIT_SCALE: z.coerce.number().min(1).max(4).default(1)`).
     1b. Add the matching `# TRANSLATE_<KEY>=` lines to `prod.env.example`. Verify: copy `prod.env.example` to `$SCRATCHPAD/prod.env.check`, set every new key live in the copy with its arm value, and `node scripts/check-prod-env.mjs "$SCRATCHPAD/prod.env.check"` exits 0. If it fails only on placeholder values unrelated to the new keys, run the check on a chmod-600 copy of the real prod.env with the keys appended instead, and never print that file.
  2. Create `translation-cost-policy.ts` exporting `interface TranslationCostPolicy { maxSpeculations: number; speculationOverlap: boolean; speculationCorrections: boolean; liveCommitScale: number; promptMemo: boolean }`, `DEFAULT_COST_POLICY` equal to today's behavior, and `costPolicyFromEnv(config: ConfigService<Env, true>): TranslationCostPolicy`. Keys that were skipped map to the default constant.
  3. Spec: an empty env yields `DEFAULT_COST_POLICY`; each key changes exactly its field.
- Verify: `pnpm --filter api test -- translation-cost-policy env.schema` exits 0.

### Task 3.2 — Thread the policy to the turn

- Steps:
  1. Inject `ConfigService<Env, true>` into `TranslationSessionService` (pattern from `purpose-token.ts`); build the policy once in the constructor.
  2. Add `costPolicy?: TranslationCostPolicy` to `TurnSessionDeps`; pass it at `new TurnSession(` (~L450). Absent → `DEFAULT_COST_POLICY`.
  3. Every spec that builds `TranslationSessionService` by hand: find them with `grep -rln "new TranslationSessionService(" apps/api/src apps/api/test`. Add a ConfigService stub returning `undefined` for every key (so defaults apply).
- Verify: `pnpm --filter api typecheck` exits 0 AND `pnpm --filter api test -- translation-session` exits 0.

### Task 3.3 — K1 and K2 in `TurnSpeculation`

- Steps:
  1. Constructor `constructor(private readonly max = MAX_SPECULATIONS_PER_TURN, private readonly overlap = true)`; `turn-session.ts` passes `policy.maxSpeculations, policy.speculationOverlap`.
  2. `canRenew`: use `this.max`. If `!this.overlap` and the current guess has not settled, return false. Track settlement with a `settled` flag set in `work.finally(…)` inside `start()` (keep the existing `work.catch(() => undefined)`).
  3. Create `turn-speculation.spec.ts` (it does not exist yet). Cases: max 2 → third `canRenew` false; overlap off → `canRenew` false while the first promise is pending, true after it resolves; defaults → today's behavior (4 renewals, overlap allowed).
- Verify: `pnpm --filter api test -- turn-speculation` exits 0.

### Task 3.4 — K3: no transcript checks on speculations (only if its gate passed)

- Steps:
  1. Add `corrections?: boolean` (default true) to the `transcribeAndTranslate` input type; when false, `correcting` is `undefined` (restore still runs).
  2. In `speculate()` pass `corrections: session.costPolicy.speculationCorrections`.
  3. Docblock at the flag: a reused speculation then carries no corrections, so hit turns show uncorrected text. That is the measured trade, and the knob exists so Phase 04 can measure it.
  4. Spec in `pipeline-translator.service.spec.ts`: `corrections: false` → the respeller's `repairHomophones` and `fuseRecognizers` are never called; default → called as before.
- Verify: `pnpm --filter api test -- pipeline-translator` exits 0.

### Task 3.5 — K4: fewer live previews (only if its gate passed)

- Steps: at the `commitChars` dependency passed to `new TurnSession(` in `translation-session.service.ts` (~L455) use `commitChars: (language) => Math.ceil(LIVE_TRANSLATION_COMMIT_CHARS[language] * policy.liveCommitScale)`. The trigger itself needs no change. Spec in `translation-session.service.spec.ts` (or the nearest spec that builds a turn through the service): scale 2 → the turn's commit threshold for `vi` is 2× `LIVE_TRANSLATION_COMMIT_CHARS.vi`; default → equal.
- Verify: `pnpm --filter api test -- translation-session` exits 0.

### Task 3.6 — K5: per-turn prompt memo (only if its gate passed)

- Steps:
  1. In `TurnSession` add `readonly translationMemo = new Map<string, Promise<string>>()`.
  2. Add optional `memo?: Map<string, Promise<string>>` to `PipelineTranslatorService.translate` requests. Key = `JSON.stringify({ text, source, target, hints, context, continuesCut })`. **Not** `models`: on prod the ladder resolves every lane to the same model (`openai-compatible-translation-provider.ts` ~L252-254); write that reason in a comment. Hit → return the stored promise and skip the provider call. Store rejected promises? No: delete the key on rejection.
  3. Never memoize a call that streams to the client (`onChunk` present). The live preview streams, so only non-streaming lanes share the memo. The duplicate diagnostic in Phase 02 tells you whether that is still worth it; if the duplicates were all live-vs-speculation, record "K5 skipped: duplicates are on the streaming lane" and skip.
  4. Spec: two identical non-streaming requests with one memo → provider called once; different `context` → twice; a rejection is not cached.
- Verify: `pnpm --filter api test -- pipeline-translator` exits 0.

### Task 3.7 — Whole-phase gate

- Verify, all must pass: `pnpm --filter api typecheck`, `pnpm --filter api test`, `pnpm --filter api lint` exit 0; with NO new env keys set, the full `translation-session` and `pipeline-translator` specs pass unchanged, which proves the defaults are today's behavior.
- Commit (`feat(api): add translation cost knobs that default to current behavior`), open a PR whose body holds the filled gate table. Do not merge; Phase 04 Task 4.0 asks the user.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
