# Brainstorm — make the cascade (STT→MT→TTS) feel live

Date: 2026-08-13 · Surface: **extension only** (user decision) · Advisory: `kongming` consulted

## Contract

**Outcome.** On the extension's cascade mode, translated speech starts **while the
speaker is still talking**, and keeps flowing. Time from first word to first
translated audio becomes a **bounded constant** instead of
`utterance_length + ~1.2s`. No captured speech is dropped.

**Constraints.**

- Extension only. Web/mobile stay as they are.
- Gemini **free tier** stays (user decision): 15 rpm + 500/day, per model per project.
- Spoken output only from a **stabilized prefix** (user decision). Audio already
  played is never contradicted.
- Local STT/TTS stay on CPU; vi model is CC-BY-NC-ND (thesis use).
- Existing contracts: `clientEventSchema`/`serverEventSchema`, `OrderedPlayback`
  ordering guarantees, the coverage-metric traps in `benchmarks/realtime/README.md`.

**Non-goals.**

- Web / mobile / half-duplex work. Not touched.
- Replacing the Gemini Live backend, or making cascade beat it on prosody.
- Streaming STT models. Cut on evidence — see below.
- Sub-1s word→voice. Not achievable here; see floor.

**Acceptance criteria.**

1. First-commit latency **flat against utterance length** (a 40s monologue starts
   speaking at roughly the same moment a 6s one does). That flat line _is_ the feature.
2. Word→voice p50 ≤ ~2s, and audio continuity: no silent gap > ~1.5s while
   committed text is pending.
3. **Zero contradicted commits** across the fixture matrix (measured, not asserted).
4. Capture coverage ≥ 99% on a 3-min continuous run — denominator from
   `vad-reference.mjs`, never from `SpeechGate`.
5. Requests/min/model stays within free tier on a nonstop speaker.

## Diagnosis — why it is not smooth today

Four distinct causes, all found in source, not inferred from the symptom:

1. **Nothing is spoken until the turn ends.** `translation-session.service.ts` buffers
   the whole utterance → STT → MT → TTS clauses. A 15s monologue = ~16s to first audio.
   This is the felt gap. Endpoint tuning cannot close it.
2. **Audio really is dropped.** `turn-pipeline.ts`: turns refused by the 3-in-flight
   ceiling retry 4× then give up on their buffered audio; `MAX_PENDING_MS` 20s evicts
   the rest. Under p95 latency a nonstop speaker hits this.
3. **8s forced cut** (`MAX_UTTERANCE_MS`, `direction-session.ts:30`) splits sentences
   mid-word; MT then loses the context across the cut.
4. **Hesitation ends turns.** `SPEECH_HANGOVER_MS` 500ms — an "ậm ừ" pause fragments one
   sentence into two turns, two MT requests, broken context. Exactly the user's test case.

Today's spend per utterance: up to **4 speculations + 3 live-preview translations + 1
final** (`translation-model-policy.ts:17`, `live-translation-trigger.ts:43`). **One**
of those produces audio; the rest are discarded or text-only.

## Measured go/no-go gate (run today, this machine, live sidecars)

The whole design rests on one assumption: re-decoding a growing buffer with an
**offline** recognizer yields a **monotone prefix**, so LocalAgreement can commit it.
Tested rather than assumed — decode every 300ms, compare consecutive reads:

|                                   | reads | decode p50 / max | contradictions of committed prefix |
| --------------------------------- | ----- | ---------------- | ---------------------------------- |
| **vi** Zipformer-30M (transducer) | 18    | 75ms / 101ms     | **0**                              |
| **en** Moonshine base (seq2seq)   | 19    | 149ms / 202ms    | **1**                              |

**vi passes cleanly.** Only the trailing 1–2 words churn (`tôm`→`tôi`, `bài`→`bàn`);
agreement withholds exactly those. Prefix never moved backwards.

**en is different and the difference is load-bearing.** Moonshine rewrites its own
prefix. Mid-read it produced `at a time` → `at set.` → `at seven in the morning` →
`at 7 in the Eve` → `at seven in the evening`. Agreement _did_ hold the commit at 12
words through the whole unstable region — the policy worked. The one contradiction was
a **surface rewrite**, `seven` → `7`, not a semantic reversal.

Design consequences, both new:

- Agreement must compare a **normalized token stream** (numbers→words, casing,
  punctuation), or the English path reports false contradictions forever.
- English needs a **deeper agreement rule than Vietnamese** (agreement-3, or
  agreement-2 plus a discarded trailing word). Per-language, not one constant.

Caveat stated rather than buried: both fixtures are TTS-synthesized clean speech.
Real disfluent audio will churn more. This measures the _mechanism_, not the margin —
setting the per-language agreement depth is a job for the fixture matrix below.

## Recommendation — commit clauses inside an open turn

Smallest change that meets the contract. Reuses machinery that already exists.

1. **Stable prefix**, from the ~300ms partial re-decodes `LivePreview` already runs
   (measured free: 422 extra transcriptions left whole-turn STT unchanged). Commit the
   longest prefix two consecutive normalized reads agree on.
2. **Commit unit = pause- or word-count-delimited.** Not punctuation: `zipformer_vi.py`
   emits **no punctuation at all** (all-caps raw, sentence-cased in `postprocess`), so
   `splitIntoClauses` on a Vietnamese source yields exactly one part. Boundaries come
   from the gate's silence runs, or N≥8–12 words. (`splitIntoClauses` on the _target_
   is unaffected — Gemini output is punctuated.)
3. **MT per committed clause, append-only** — pass already-spoken target + committed
   source, instruct continue-never-rewrite. Substitutes for wait-k, which needs decoder
   control Gemini does not expose.
4. **TTS the clause immediately**, pushed on the same turn key. `OrderedPlayback`
   already separates "turn finished" from "turn starved between clauses" — this is the
   case it was built for.
5. **At the endpoint, translate only the uncommitted remainder.** This is what collapses
   the post-speech tail from p50 1163ms to one short clause.
6. **Retire per-turn speculation on this path.** There is no big end-of-turn translation
   left to pre-warm. This is where the quota for commits comes from.

**Quota: roughly flat, and better value.** One request per committed clause, ~3–4s
minimum commit → ~15–20 rpm for a nonstop speaker, against two flash-lite ladders
(30 rpm) plus per-project key rotation. Replaces the 5–8 discarded requests per turn.
Every request now produces audio.

**Why vi↔en tolerates this.** Both SVO. Divergences (noun-adjective order, classifiers,
final question particles) resolve at clause granularity — which is the commit unit.
This design would be far riskier for ja/de→en.

### Honest floor (do not promise better)

Per clause-ending word: transport ~50–100ms + boundary detection ~250–300ms + partial
cadence/decode ~210–250ms + one agreement cycle ~300ms + MT 553ms p50 + TTS first
sample ~527ms + playback ~50–100ms ≈ **~1.9s p50**. p95 is dragged to ~3.3s by the MT
tail (1947ms p95, 8943ms worst). Words _inside_ a clause additionally wait for their
clause to finish — linguistics, not engineering.

Refuse to promise: sub-1s lag; Gemini Live's prosodic continuity (per-clause
VieNeu/Kokoro concatenation has audible joins — TTS architecture, not a bug);
zero awkward boundary translations; unlimited free-tier session length.

## Options considered

|          | Approach                                                    | Cost to abandon                                                            | Fails first when                                                                                           |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A ✅** | Commit clauses inside an open turn (above)                  | Medium — new policy class + session changes, additive to the wire contract | MT p95 tail stalls the stream mid-utterance → audible dead air                                             |
| B        | Keep turns, shrink them: cut at ~150ms quiet, lower ceiling | **Low** — mostly constants                                                 | Each micro-turn translates without cross-clause context → quality drops and rpm rises with nothing gained  |
| C        | Point users at the Live backend for smoothness              | None                                                                       | Abandons the user's stated goal, and the cascade's reason to exist (local, free, no per-minute cloud cost) |

B is the cheapest to abandon and worth keeping as the fallback if A's commit policy
proves unstable on real disfluent speech.

## Test matrix (makes "smooth" falsifiable)

Extend `benchmarks/realtime/analyze-continuous.mjs`; keep `vad-reference.mjs` as the
independent denominator.

**Metrics:** first-commit latency **plotted against utterance length** (flat = working);
per-clause lag p50/p95 + drift slope over 3 min; audio-continuity gaps while text is
pending; contradicted-commit count (must be 0); spoken-concatenation adequacy vs an
offline full-turn translation of the same audio; rpm per model per key + daily burn.

**Fixture shapes:** 30–60s no-pause monologue (forced-cut + drift stressor); mid-sentence
pauses 300–800ms (between `PROBABLE_END_MS` 150 and hangover 500 — the false-boundary
killer); "ậm ừ" fillers and restarts; rapid short-turn ping-pong; noise-floor shifts.

**Where ElevenLabs is legitimate:** commit-policy correctness, latency, quota,
pause structure — timing is exactly controllable, and it is _more_ independent than
today's fixtures, which `generate-fixtures.mjs` builds from our own TTS sidecar
(self-dealing worth removing regardless).
**Where it flatters:** VAD robustness, WER, disfluency, echo — synthetic speech has no
room tone and no coarticulated hesitation. Those need the real recordings the user
agreed to.

## Sequence

1. Extend the harness + fixtures first — it is the instrument for everything after,
   and it measures the current path as the baseline to beat.
2. Commit-policy class (normalized agreement, per-language depth, pause/word boundary)
   beside `live-translation-trigger.ts`.
3. Wire commits into the session service: append-only MT → clause TTS → same turn key.
4. Retire speculation on the continuous path; re-measure rpm.
5. Re-run the matrix; compare against the phase-1 baseline.

## Unresolved questions

1. **Free tier vs the MT tail — a decision I am flagging, not overriding.** You chose to
   stay on free tier. The measured risk: Gemini p95 1947ms / worst 8943ms means roughly
   1-in-20 clauses arrives late enough to leave an audible hole mid-utterance, and 500
   req/day/model burns a key-pair in ~60–90 min of continuous speech. A local MT sidecar
   (NLLB-600M-distilled int8 or envit5, ~150ms/clause, ~1GB RAM) removes both, at lower
   translation quality and one more service. Options: (a) stay free tier, accept the
   holes, measure them in step 5 and revisit; (b) add local MT for _spoken commits_ only
   and keep Gemini for the displayed transcript, which is retractable. **Recommend (a)
   now** — step 5 produces the number that settles it, and (b) stays cheap to add later.
2. Inbound direction language mix: does a meeting ever carry both languages on the same
   inbound stream? If so, agreement depth is per-utterance and the language must be
   resolved before committing.
3. Does the 8s forced cut survive at all once turns carry commits, or does the ceiling
   move to a much larger value with commits doing the work?

## Handoff

Direction A accepted → the installed plan skill, then `/ak:cook`. Carry `--advice`.
