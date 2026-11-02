# Brainstorm: an LLM-judge ruler for translation quality

The question was "can translation get a harness like the AK kit?". It can, and most of the harness already exists. What it lacks is a ruler, the translation counterpart of a test suite. The user chose an LLM judge and will not grade by hand (2026-11-02).

## Evidence

- The harness pieces already in the code are: the prompt and session hints, 4-utterance context (`conversation-context.ts`), `learnedTerms` fed to STT, the user glossary, the second-pass polisher (`turn-polisher.ts`, fire-and-forget), `repairDisplay`, the block retranslator, and the cost policy.
- The digest oracle (PR #289) found no headroom on terms: baseline 0.973, 3 misses in 111. Injecting context flipped 8 of 33 controls. Adding context is not the lever.
- No reference translations exist, and the user will not write them. Model-written references stay forbidden. A judge does not write references, so it does not conflict with that rule.
- Prior measurements say the recognizer dominates vi errors (prod vi STT 8.6% WER against Scribe). The first row of the current corpus shows it: "phát CAS … thứ 68 giờ tối" is a mishearing that the translator partly papered over. A text-only judge cannot tell a mishearing from a mistranslation.
- Reusable assets:
  - `benchmarks/conversation-context` holds 3 conversations, 79 turns plus 11 controls, with source and prod draft.
  - `benchmarks/error-analysis` has the error categories.
  - `benchmarks/stt/stt_bench/scribe_reference.py` turns Scribe v2 output into a reference transcript.
  - `benchmarks/mt-zh` already pins `unbabel-comet`.

## Contract

- **Outcome:** a repeatable ruler that says, per prod turn, whether the shown translation is wrong and why: misheard (ASR), mistranslated (MT), cut at the wrong place (segmentation) or term. Its output is a table of error rates by source, which picks the next harness piece (review loop, domain packs, or STT work) with evidence.
- **Constraints:**
  - The judge must be independent of the translator (DeepSeek) and the polisher model. Gemini is the default judge.
  - No paid calls on the live path, and no change to prod behaviour.
  - Read-only prod export, following the `conversation-context` export convention.
  - Results stay gitignored, and scorers write to stdout only.
  - No reference translations, either human or model-written.
- **Non-goals:** building the review loop or domain packs; changing prompts; a public quality dashboard.
- **Acceptance criteria:**
  1. Error rates by source on at least 150 prod turns from at least 5 conversations.
  2. The judge is calibrated on known answers:
     - it catches at least 80% of injected perturbations: a wrong number, a dropped negation, a swapped name, an omitted clause;
     - it flags at most 10% of the unperturbed turns that the term check already passed;
     - its labels agree on at least 80% of turns across 3 repeats.
  3. A GO/NO-GO note naming which harness piece the table supports.

## Approaches

|                     | A. Text-only MQM judge                                   | B. Scribe transcript + MQM judge (recommended)                                          | C. CometKiwi score only                           |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| What the judge sees | prod transcript, context, translation                    | the same, plus an independent Scribe transcript of the turn audio                       | source and translation; returns a number          |
| Error source        | guessed from text                                        | ASR = prod vs Scribe diverge in meaning; MT = translation unfaithful to the Scribe text | none                                              |
| Leans most on       | a mishearing looking garbled                             | Scribe being right on vi (already used as the vi ruler)                                 | a score being enough to act on                    |
| Fails first when    | the mishearing reads as plausible text ("anh tiến hành") | Scribe also mishears, as on fast podcast handoffs                                       | the table has to name a fix; a score has no "why" |
| Cost                | ~1 judge call per turn                                   | adds 1 Scribe call per conversation                                                     | local CPU                                         |

**Trade-offs.**

- A is the cheapest, but it charges ASR errors to MT, which is the exact confusion the ruler exists to remove.
- B adds one paid transcription per conversation and depends on Scribe.
- C cannot pick a fix on its own, but it is a free second witness. It is CC-BY-NC, which is fine for a non-commercial thesis. Run it beside B to check that the judge's severities move with an independent score.

**Better approaches:** none. An LLM judge is the requested direction. B is the version of it that can separate hearing from translating (evidence: recognizer-dominates measurements, corpus row 0).

## Judge design (for the plan)

- Use GEMBA-MQM style. The judge lists errors as {span, category, severity minor/major/critical, source ASR/MT/segmentation/term}. It does not give a single 1–10 score, because span lists are auditable and stable.
- Use temperature 0 where the model allows it, 3 repeats, and keep an error only when it appears in at least 2 of the 3.
- Give the judge the 4 previous utterances so it can grade context-dependent turns fairly.
- For later arm comparisons (review loop vs baseline), use pairwise judging with both orders and count only consistent wins.
- Calibration controls are generated by perturbing prod drafts with deterministic rules, not by a model, so their ground truth is known.

## Risks

- The judge's own Vietnamese may be weak. The perturbation recall gate catches this. If Gemini misses more than 20%, try a second judge model before trusting any table.
- Scribe availability and cost: one call per conversation is small, and the API key slot already exists in `.env.example`.
- Five conversations may be too few to separate the sources. Report confidence intervals, and add conversations rather than repeats.

## Unresolved questions

- Which Gemini model judges: the strongest available (pro tier) or flash? The default is the strongest within the 500/day quota. About 150 turns × 3 repeats plus controls is roughly 600 calls, so the run spans 2 days or 2 keys.
- Which 5+ conversations to export: the plan will propose them from prod, favouring mixed vi/en and at least one with domain terms.
