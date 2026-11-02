---
phase: 3
title: 'Ship the winning pass'
status: in-progress
effort: '0.5-1d'
---

# Phase 03: Ship the winning pass (only on a GO from phase 02)

## Goal

Put the winning arm into the live polisher with no change to live latency, confirm it on the prod model, and record the result.

## Context

- The polisher is fire-and-forget after `server.transcript.final` (`turn-polisher.ts`). It never delays the draft, so adding context does not add latency to anything the listener waits on.
- **Context must be read before the turn is remembered.** Call `this.context.recall(socket)` before `rememberSegment`, otherwise the turn would be its own context.
- When Command Code is spent, the draft stands. This is a user decision; no fallback is added.

## Files (arm 2 wins: the expected case)

- **Modify `apps/api/src/modules/translate/session/turn-polisher.ts`:**
  - add `context?: string[]` to `TurnPolishInput`;
  - pass it to `polisher.polish({... context})`.
- **Modify `apps/api/src/modules/translate/services/translation-session.service.ts`:** at both polish call sites (lines 1169 and 1610), pass `context: this.context.recall(socket)`, read before `rememberSegment`.
- **Modify `apps/api/src/modules/translate/session/turn-polisher.spec.ts`:** a test that the context reaches the polisher request.
- **Modify the `translation-session.service` spec (whichever covers polish):** a test that the polished turn's context excludes the turn itself.
- **If arm 3 wins instead:** the critique-then-rewrite pass goes in `packages/ai-providers/src/providers/openai-compatible/` as a polisher variant. It needs its own spec and must keep `accept()`'s guards. Re-scope this phase before coding.

## Steps

1. Implement and test: `pnpm --filter @chatofy/api test -- turn-polisher translation-session`, then typecheck and lint.
2. Confirm on the prod model. After Command Code's window reopens (2026-11-04 10:09 VN), run the winning arm with `--model gpt-5.6-sol` on the Command Code host, then judge and compare it. The judge cost is about $6.4.
   - The GO holds when AC-2 and AC-3 hold on this model too.
   - If they do not, ship the code anyway only when the result is not worse than arm 1 on `gpt-5.6-sol`. Record the gap.
3. Commit, open a PR, merge and deploy through the usual route.
4. Verify on prod. Replay a recording under the owner account (memory: verify prod rollout by replay) and check the `llm kind=polish ... ok=1` lines in `chatofy_prod_api` logs.
5. Record:
   - a `docs/development-journey.md` entry with the before and after table;
   - an update to the memory `translation-errors-split-by-direction`;
   - plan status set to completed.

## Validation

- Tests, typecheck and lint pass.
- Prod logs show polish calls with context after deploy.
- The journey entry cites the arm table.

## Risks and rollback

- **Context makes the polisher over-edit on prod traffic.** The en→vi guard in phase 02 bounds this. Rollback is reverting the commit. The change is a few lines and has no schema, env or contract change.
- **Command Code is still spent at deploy time.** The code ships, and verification waits for the window. The plan stays `in-progress` until the prod check is done.
