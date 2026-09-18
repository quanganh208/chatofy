# PR #163 ultra review — final union (review-only, `--ultra`)

PR: quanganh208/chatofy#163 "fix(conversations): repair the record from the decoder to the timestamp" — +6262/−149, 67 files, head `7bf006f9`, base `main`. CI 10/10 green, mergeable CLEAN. Tree = PR head, all findings checked against it.

## Summary

Repairs four measured defects in how a conversation's stored record matches what was spoken: English-word loss in the Vietnamese decoder (contextual hotword biasing), a timestamp that ignored capture pre-roll, a phantom-speaker hole for short turns (1250ms speech floor), and hesitation fragments translated without sentence context. Adds `speechMs` measurement to the sidecar's `/embed` and server-side dropped-turn logging.

## Risk level

Medium — large measured diff touching a WS wire contract and Python sidecar weights, but every PR-body claim re-verified against the tree held, CI is green, and no correctness defect survived verification.

## Findings (evidence-validated union)

### Important

1. **PR body fails the repo's required-section contract.** `pr-body-contract.cjs` flags all 7 required sections (`end-to-end-summary`, `subagent-delegation`, `technical-decisions`, `deviations-from-plan`, `completion-evidence`, `checklist`, `human-actions-required`) plus both traceability sections (`linked-issues`, `ship-mode`) as missing. The substance exists in the body's prose; it needs restructuring under the contract headings, not new content. All five reviewers independently confirmed.
   - Fold in: the body says `transcript-time-parity.spec.tsx` "passes untouched" but the PR edits that file (adds the pre-roll case); the accurate sentence is "existing cases pass unchanged".

### Suggestions (validated, non-blocking)

2. `speechMs` is a **required** field on the `server.turn.embedding` wire schema (`packages/types/src/events/ws-events.ts:651`). Old-server/new-client skew would drop every embedding event with a per-turn `onError` (`translate-socket.ts:108-112`). Mitigated: monorepo co-deploy, zod strips unknown keys in the reverse direction, and `audioMs` set the same required-field precedent (`4e9a535f`). Fix: one deploy-note sentence now; `.optional()` + `?? 0` as a follow-up cluster with #11 (`Math.round` at `embedding-provider.ts:82`). Corroborated by all five reviewers.
3. Prebuffer ceiling logs one line per ~21ms dropped block (`conversation-session.ts:592-598`, ~47 lines/s during a hung connect); the same handler at :766 has a `captureStopped` guard the prebuffer path lacks. Edge-or-count logging.
4. `ensure_bpe_vocab` trusts an existing cache file and writes non-atomically into a shared tempdir (`services/local-stt/engines/zipformer_vi.py:75-85`). Fix: tmp + `os.replace`.
5. Operator instruction paragraph fires on speech-only context blocks too (`gemini-translation-provider.ts:143-146` vs `prompt-builder.ts:247-252`). Wording-scope only; injection corpus stayed green.
6. Hotword biasing gated three times (`app.py:95`, `engines/base.py:183`, `zipformer_vi.py:129-133`) — one answering layer would be cleaner.
7. `takePriorSpeech` `slice(-240)` can split a surrogate pair (`prompt-builder.ts:442`). Vanishingly rare for Vietnamese.
8. Sidecar pytest not wired into CI; this PR adds the most arithmetic-heavy pure functions the sidecar has.
9. `test_hotwords.py` docstring "No model weights needed" contradicted by its own bpe-vocab test path (needs `bpe.model`, no skip gate).
10. Refusal retry window amplifies load ~7x with no backoff (`turn-pipeline.ts:75,484`) — documented, measured trade; capped backoff is a follow-up.
11. Four already-oversized files grew further (`conversation-session` 977→1106, `prompt-builder` 391→546, `turn-keyed-transcript` 763→856, `translation-session` 755→799) — pre-existing debt tilled, note for the next split.

Dropped by verification: "fetch-mock hygiene — new API-provider tests skip restore" (the spec restores in `afterEach` file-wide; the claim was disproven by the code).

## Verdict

**Request changes** — solely for the Important body-contract finding. No correctness defect survived five independent reviews plus validation; the code is approve-quality once the body is restructured under the contract headings.

## Ultra provenance

- 5/5 candidates usable (Opus tier, one parallel wave; slots 1 and 4 needed the single bounded re-dispatch after API-524 transport errors — reports complete on retry).
- Verifier: same-tier (Opus). The strongest-model route (`kongming` → `fable`) failed with provider error 400; degraded per the ultra model-tier rule, so this run is **same-tier best-of-5** (independent samples + rubric selection), not asymmetric verification.
- Letter mapping (controller-private): A=c4, B=c2, C=c3, D=c1, E=c5. Reports in `.claude/scratch/pr163-evidence/`.

## Unresolved questions

- Recorded benchmark/replay numbers were not independently re-executed (static verification only).
- Plan prose in `plans/260918-1448-…/phase-4-measurements.md` states a "2.2×" ratio that does not reconcile with its own figures (13.4/5.38 = 2.49×) — plan-only, nothing wrong published.
