# Brainstorm: the interpreter harness, now that a ruler exists

The ruler (`benchmarks/translation-judge`, report `benchmark-261102-1911-translation-judge-ruler.md`) says where the errors are. This decides which harness piece comes next and how to prove it helps before it ships.

## Evidence

- **Ruler findings:**
  - vi→en has a serious translation (`mt`) error on 23.7% of turns. The errors are semantic: "Ai" (AI) read as "whoever", invented clauses, self-talk turned into a question.
  - en→vi `mt` is 1.3%. Terminology and segmentation cause 0% of serious errors.
  - Hearing (`asr`) causes 14.2% of turns. 5 of those turns are language-ID errors, all in one two-way conversation.
- **A second pass already exists.** `turn-polisher.ts` sends every finished turn to `gpt-5.6-sol` on Command Code. Its prompt (`translation-polish-prompt.ts`) already asks it to fix mistranslations and omissions. Gaps found by reading the code:
  1. **No context reaches it.** Both call sites in `translation-session.service.ts` (lines 1169 and 1610) omit `context`, so the prompt's `<context>` block is never filled. The judge needed context for exactly these errors: "AI" is unambiguous only from the earlier turns.
  2. **One host, no fallback.** When Command Code's window is spent, the circuit opens and the draft stands. That was the case on 2026-11-02, with the weekly limit lasting until 2026-11-04.
  3. **Nobody knows whether it helps.** There is no record of which stored translations were polished. Prod logs restarted 2026-11-02 10:17Z and hold no turns since, so the history cannot answer it.
  4. **The fix is not saved server-side.** The server keeps the draft (`rememberSegment`). The client replaces the line and saves the polished text through `use-conversation-save`. That is why the stored translation may be either version.
- **Offline replay is cheap.** The corpus (162 turns with source, Scribe hearing, context and stored translation) can feed any candidate pass. Judging one arm costs about $6.4. About $91 of the $100 cap is left.

## Contract

- **Outcome:** a harness change that measurably lowers the serious `mt` rate on vi→en, proven on the ruler before it ships, plus the experiment rig that proves the next change too.
- **Constraints:**
  - Live latency is unchanged. The second pass stays fire-and-forget after the draft.
  - The judge stays `claude-opus-5-5`. If the reviewer is also Claude, the judge may favour its own family, so a Claude-written arm needs CometKiwi agreement before it counts.
  - Judge spend stays within the remaining $100 cap. Reviewer calls are billed to their own host.
  - No reference translations.
- **Non-goals:**
  - STT and LID work, which have their own lever and track.
  - Changing the first-draft translator or its latency budget.
  - Domain packs and glossaries, which the ruler showed have no headroom.
- **Acceptance criteria:**
  1. A replay rig produces, per arm, a new translation for each corpus turn, judged with the same judge, repeats and consensus as the baseline.
  2. The winning arm lowers vi→en serious-`mt` turns against the stored baseline, with the paired bootstrap interval of the difference excluding 0.
  3. The winning arm does not raise en→vi serious errors.
  4. The winning arm does not lower CometKiwi on average.
  5. p95 reviewer latency stays under the 8 s polish timeout, and cost per turn is recorded.
  6. Only then, a code change ships the winning arm. A prod replay confirms polish events are emitted.

## Approaches

|                  | A. Fix the existing polisher (recommended)                                    | B. Critique then rewrite                                                                   | C. Stronger first draft for vi→en                     |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| What changes     | Pass the 3–4 earlier turns as context; give it a fallback host; keep one call | Call 1 lists meaning errors against the source; call 2 rewrites only when call 1 found any | Translate vi→en finals with a stronger model directly |
| Leans most on    | One edit call can catch semantic errors when it sees context                  | Spotting an error is easier than fixing it silently                                        | A better model in the live path                       |
| Fails first when | The editor rewrites correct lines, which costs en→vi                          | Two calls exceed the 8 s window or the budget                                              | Latency: the draft is what the listener hears         |
| Cost             | Code change of a few lines; 1 call a turn                                     | 1–2 calls a turn; new prompt                                                               | Live latency and quota, both measured tight before    |

**Trade-offs.**

- A is a few lines of code. The arms test whether context alone fixes the errors. Its risk is over-editing, which is why the en→vi guard is in the acceptance criteria.
- B buys precision, because the edit fires only on a named error, at the price of a second call. Run it as an arm only if A leaves most vi→en errors in place.
- C attacks the cause, but it pays in the one place the product cannot afford: the draft the listener hears.

**Better approaches:** none. A review pass is the lever the ruler supports. The finding is that the pass already exists but runs blind, without context, and unmeasured.

## Proposed arms for the first experiment

- **Arm 0:** the stored translation, which is the current baseline.
- **Arm 1:** the current polish prompt with no context. This is what prod does.
- **Arm 2:** the current polish prompt with 4 context turns.
- **Arm 3:** the critique-then-rewrite pass, only if arm 2 leaves more than half of the vi→en `mt` errors.

All arms run on the same reviewer model. Candidates are `gpt-5.6-sol`, available after 2026-11-04 on Command Code, or a paid model reachable now. The source is the app's own hearing, as in prod, not Scribe's.

## Risks

- **Self-preference:** if the reviewer is Claude, the Claude judge may favour it. Mitigation: use a non-Claude reviewer, and require CometKiwi agreement.
- **Small vi→en slice:** with 76 turns and wide intervals, a modest gain may not separate from noise. Mitigation: use a paired comparison on the same turns, and add new recordings if needed.
- **Over-editing:** a pass that rewrites too eagerly turns a right line wrong. Mitigation: the en→vi guard, plus a rewrite rate per arm.

## Unresolved questions

- Which reviewer model should the arms use? Waiting until 2026-11-04 for `gpt-5.6-sol` keeps the experiment identical to prod. A paid model reachable now is faster but is not what prod runs.
- Should the shipped fix also add a fallback host for the polish when Command Code is spent, or should the draft keep standing as now?
