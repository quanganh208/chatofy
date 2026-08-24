# Brainstorm — speaker attribution on web (N speakers)

Date: 2026-08-24 · Surface: `apps/web` (live streaming path) · Status: contract accepted, bench-gated · advisory GO with 5 amendments applied

## Contract

**Outcome.** Transcript on web carries per-turn speaker identity derived from **voice**, not from
translation direction. Unknown speaker count (3–5 typical, cap 8). Anonymous labels
("Người nói 1/2/3"), provisional-then-corrected. Works in one-way (all speakers share source
language) and two-way modes.

**Constraints.**

- No new Python dependency. `sherpa-onnx==1.13.4` + `onnxruntime==1.27.0` are an ABI-coupled
  pinned pair — do not bump. Speaker APIs already exported (verified).
- STT stays local CPU. Weights bind-mounted from `models/`, fetched by `scripts/download_models.py`.
- **No increase in Gemini requests per turn.** Free tier ~30 turns/min across the model ladder.
- Added latency ~0 at p50: embedding runs concurrent with translation via a SEPARATE `/embed`
  call (723ms p50 covers it). Piggybacking it on `/transcribe` would be serial — see Design.
- Web is half-duplex (`capture-pump.ts` `awaiting-result`) — mic withheld during playback.
- Session-scoped, in-memory only. No voiceprint persisted, none linked to a name.

**Non-goals.**

- Overlapping-speech separation (single mixed mic; RMS VAD cannot detect overlap).
- Cross-session speaker memory / named enrollment (approach C, deferred).
- In-turn diarization (approach B) — belongs to the extension's continuous mode, not here.
- Changing TTS voice per detected speaker.

**Acceptance criteria.**

- Kill gate (below) passes.
- Simulated-session bench: per-turn live attribution and post-re-cluster attribution reported;
  agreed target **live 80–90%, final transcript 90–95%** for 3–5 same-language speakers.
- Speaker-count error (minted vs true) reported.
- End-to-end turn latency delta ≈ 0 measured on the prod container.
- Turns <1.0s net speech emit `unknown` rather than a guess.

## Decisions taken (user, 2026-08-24)

1. Accuracy = measured band, not absolute. Live 80–90% / final 90–95%. Anonymous chips, relabel allowed.
2. User will self-record the 3–5 person far-field fixture (20–30 min, real laptop, 0.5–2m).
3. Next axis = **benchmark first, behind a kill gate**. No product code until it passes.
4. Per-language namespace accepted; bilingual person → two IDs, documented.

## Design (approach A)

Per-turn embedding + online clustering. Rejected alternatives: B (in-turn diarization) is
quota-fatal and is a superset of A anyway — spectral labels don't survive across calls, so it needs
A to bridge turns; C (enrollment) deferred, and its biometric exposure comes from _persistence_,
which A avoids by construction.

- **Sidecar stays stateless. Separate `POST /embed` — do NOT piggyback on `/transcribe`.**
  Piggybacking is serial by construction: translation cannot start until it has the transcript text,
  and the text would arrive in the same HTTP response as the embedding, so the embedding cost lands
  _before_ translation. That is +30–100ms (CAM++) or +150–500ms (ERes2NetV2, i.e. 13–43% of the
  1163ms budget) — it violates the delta≈0 constraint. A second localhost upload + decode of a
  few-second 16k clip costs single-digit ms; the "avoid a second decode" optimization would buy a
  30–500ms serialization to save ~5ms. Node already holds the buffer it posted to `/transcribe`.
  Extractor gets its **own session and lock**, with `num_threads` 1–2 (the embedding nets are small;
  this avoids oversubscription when another session's STT overlaps).
- **Clustering state lives in the Node API, per connection** (matches `TurnSession` ownership).
- **Leader-follower, dual threshold, dead zone.** L2-normalize; cosine vs centroids.
  `≥ τ_hi` → assign + update centroid. `< τ_lo` → mint. Between → assign provisionally,
  low-confidence, **do not update centroid**. Dead zone is what blocks both same-person-split and
  two-people-collapsed simultaneously.
- Centroid = duration-weighted running mean (store sum + count); only high-confidence turns
  ≥2s net speech update it.
- **Merge pass** after each mint and every ~10 turns: centroids above τ_merge merge + remap.
- **Speaker cap 8** per session. A newly minted speaker stays **tentative until it has 2 confirmed
  turns** — rendered differently, and freely relabelled, so churn is confined to exactly the ids
  that have not earned confidence yet.
- **Per-language namespace.** Direction gives each turn's language free. vi clusters only against vi
  centroids. Sidesteps cross-lingual mismatch (40–284% relative degradation in the literature).
- **Deferred re-cluster is the accuracy backstop, in scope from day one.** Every ~20 turns and at
  session end: full AHC over stored turn embeddings, Hungarian map back to display IDs. Uses
  _relative_ distances within one channel — far more robust than any absolute threshold. This is
  where the 90–95% number comes from.
- **Short-turn ladder.** <1.0s net speech: never mint, never update, assign only if `≥ τ_hi`, else
  `unknown`. 1–2s: assign by threshold, no centroid update. ≥2s: full participation. Carry-forward
  from the previous turn is **wrong** here. In two-way mode half-duplex forces alternation, so
  adjacent turns are _more_ likely to be different people. In one-way mode (meeting style, all one
  language) consecutive same-speaker turns are common, so the rule holds for a weaker reason there —
  the per-language namespace is still the stronger prior either way.
- Concurrency: fire embedding + translation in parallel at turn end; attribution attaches to the
  final transcript event. Live partials show previous attribution or "detecting"; never block them.

### Contract change — additive only

Do **not** widen `speakerRoleSchema`. `speaker_a`/`speaker_b` is _side of conversation_ — it drives
voice/direction routing and is consumed by the persisted `transcriptSegmentSchema` and
`ws-events.ts:178`. Identity is orthogonal: several people share the vi side. Add a new **optional**
field (`speakerId` + provisional/confidence flag). Old records and the extension stay valid.
`turn-session.ts:115` keeps its routing role; only its _display_ role is superseded.

## Model candidates — settled by measurement, not argument

Advisors disagreed. Bench decides.

| Model                                             | Size          | Note                                                                                                                                                   |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `3dspeaker_eres2netv2_sv_zh-cn_16k-common`        | 71.4MB, 17.8M | Best published short-duration (0.98% @3s, 1.48% @2s VoxCeleb1-O). 200k-speaker tonal corpus — plausible VN transfer. dim 192.                          |
| `3dspeaker_campplus_sv_zh_en_16k-common_advanced` | 28.3MB, ~7M   | Only explicitly **bilingual** model in the zoo. 2–4x cheaper, slightly worse short-duration.                                                           |
| wespeaker VoxCeleb / NeMo TitaNet                 | —             | English-only, ~7k speakers. Baselines only — kongming rates known-bad for VN; research rated them best available. Disagreement unresolved by argument. |

**No int8 exists for any speaker embedding model** in the release (unlike ASR). fp32 on CPU is fine;
do not self-quantize initially. **No Vietnamese-trained model exists at all.**

Latency ballpark to sanity-check against (measure, don't trust): CAM++ ~30–100ms per 3s turn;
ERes2NetV2 ~150–500ms (12.6 GFLOPs).

## Kill gate — before any product code

Two checkpoints. The pairwise screen is **necessary but NOT sufficient** — it gates _continuation_,
not acceptance. Bench 2's per-turn number is the acceptance criterion.

**Checkpoint 1 (screen).** Metric: **EER** over same/diff pairs, computed **per duration bucket**,
**far-field subset only**, at the **2s** bucket. If no model reaches ≤10% EER there, stop and re-open
options (named enrollment, longer-turn UX, or labels declared best-effort).

Pair construction is where a bench lies: same-speaker pairs drawn from _adjacent_ segments share
channel conditions (position, AGC state, reverb), inflating similarity and understating EER so the
gate passes falsely. **Require same-speaker pairs to be temporally distant and cross-position**
(0.5m vs 2m); diff-speaker pairs from matched conditions.

**Checkpoint 2 (acceptance).** ≤10% pairwise EER does not imply 80% live accuracy — with 4–5
centroids, cold start, and dead-zone non-updates, expect per-turn error ≈1.5–2.5× pairwise.
**If bench 2 live accuracy is <70% after threshold tuning, stop** with the same re-open options.
Without this checkpoint a model that passes the screen but fails end-to-end has no exit.

Benches under `benchmarks/speaker-id/` (sibling of `stt`, `tts`, `realtime`):

1. **Pairwise** — same/diff cosine histograms per model × duration bucket (1s/2s/3s) × near/far.
   Outputs EER, distribution overlap, derived τ_hi/τ_lo. τ_hi at ~1% false-accept on diff-pairs,
   τ_lo at ~5–10% miss.
2. **Simulated session** — turn order random, lengths sampled from the measured turn-length
   histogram, run the exact online algorithm. Outputs per-turn accuracy, speaker-count error,
   post-re-cluster accuracy. **This number becomes the acceptance criterion.**
3. **Latency** — embedding ms per model on the prod container; end-to-end turn delta.

**Segmentation: benches MUST cut the fixture with a replica of the production speech gate**
(energy RMS, 500ms hangover, per `speech-gate.ts`) — never oracle or manual cuts. Oracle-cut benches
overstate accuracy and the numbers will not transfer to prod. This also measures the VAD's effect on
attribution in place.

### Anti-circularity — run BOTH, report both

As first written, bench 2 derived thresholds from bench 1 on the same fixture it then evaluated on:
fitting and testing on the same data.

- **Primary (deployment-honest).** Calibrate τ_hi/τ_lo on **public corpora** — VIVOS for vi,
  LibriSpeech slice for en — then evaluate bench 2 on the self-recorded fixture, fully held out.
  This is the production condition: thresholds fixed a priori, the user's room unseen. Failure here
  from threshold shift alone _measures_ risk #1 instead of assuming it, and says how much load the
  deferred re-cluster must carry. (VIVOS is close-talk read speech — the domain shift is the test,
  not a bug.)
- **Secondary (diagnostic upper bound).** Temporal split of the fixture: calibrate on the first ~40%,
  evaluate on the rest. Same room and speakers, so optimistic vs deployment, but it bounds what is
  achievable if thresholds could adapt.
- **The gap between the two is the measured threshold non-stationarity.** Report it explicitly.

Speaker-disjoint splits are impossible with 3–5 people — do not pretend otherwise.

### Fixture recording protocol — must reach the user BEFORE they record

A wrong-channel fixture invalidates every downstream number, silently.

1. **Record through the actual browser capture path** (or a minimal page with identical
   `getUserMedia` constraints). A voice-recorder app gives 44.1k with no AGC; prod audio goes through
   getUserMedia with AGC typically on. Thresholds calibrated on the wrong channel are worthless and
   the bench will pass anyway.
2. **Keep a turn log.** 25 min of free conversation has no per-turn ground truth, and hand-labeling
   afterwards is slow and ambiguous in overlap regions. Use a written turn-order sheet, or one person
   logging turns live. Scripted alternation is representative, not a cheat — half-duplex prod _is_
   turn-based.
3. **Prefer 2×12–15 min sessions** (different day, or reshuffled seating) over 1×25 min. Same total
   effort, and it yields a genuine session-level split. Not a blocker — the temporal split is the floor.
4. Cover both distances (0.5m and 2m) and have people move between them, so cross-position pairs exist.

Fixtures: self-recorded far-field (primary, user committed) + VIVOS (46 VN speakers) + a LibriSpeech
slice for en. `benchmarks/realtime/generate-fixtures.mjs` and the VLSP clips are the pattern to extend.

### Bench output rules — so failure is visible, not absorbed

- Every bench writes **per-turn CSV artifacts** (turn id, duration bucket, net speech ms, true
  speaker, assigned, confidence margin) — never only an aggregate.
- **Report per duration bucket separately.** The 1s bucket's badness must not be averaged away by 3s turns.
- Bench 2 reports the **speaker-count trajectory** (minted vs true, over time). Count errors are the
  loud failure mode a single accuracy number hides.
- Gate scripts **exit non-zero** on failure, CI-style. A prose "hmm, 12%" gets rationalized; an exit
  code does not.
- Bench 1 emits the same/diff **cosine histograms as images**. Distribution overlap is the honest
  picture; a single EER can hide a bimodal disaster.

## Risks

1. **Threshold non-stationarity — biggest.** A cosine threshold calibrated on one laptop will not
   hold on another device; browser AGC and a speaker moving 0.5m→2m can shift similarity more than
   the gap between two different speakers. Mitigation _is_ the deferred re-cluster plus conservative
   τ_hi — which is why that pass is day-one scope.
2. **Expectation.** "Speaker detection" heard as named, always-correct labels makes an 85% anonymous
   -chip feature read as broken. Anonymous-label UX + the agreed number are part of the deliverable.
3. Cold start is irreducible: first turn of each new speaker is a guess by definition.
4. **Browser DSP is deliberately ON, all three of it.** `use-streaming-translate.ts:109-117`
   enables `echoCancellation`, `noiseSuppression`, and `autoGainControl`. Noise suppression and
   AGC both reshape voice timbre — the exact quantity an embedding measures. This is a stronger
   channel-drift source than AGC alone, and it is why the fixture must be recorded through the
   real capture path rather than a recorder app.
5. Overlap is silently misattributed; no detection path exists on one mic.
6. `TenVadModelConfig` is already exposed and claims better precision than the current energy-RMS
   gate. **Out of scope for this delivery** — swapping VAD mid-delivery changes the turn-length
   histogram bench 2 samples from and confounds attribution results with segmentation changes.
   Named instead as the **designated remediation lever**: if checkpoint 1 lands marginal (10–15% EER),
   re-run bench 1 with TEN-VAD cuts before declaring kill.

## Evidence

- sherpa-onnx speaker APIs present in the running prod container (`__init__.py` exports verified).
- `turn-session.ts:115` derives speakerRole from direction; `speakerRoleSchema` is a 2-value enum.
- `capture-pump.ts` half-duplex `awaiting-result`; `speech-gate.ts` 500ms hangover, energy RMS.
- Measured budget p50 1163ms (STT 58 / translate 723 / TTS first clause 527).
- `conversation-transcript.tsx` renders **no** speaker label today — this is new UI, not a field swap.
- Web also has a one-shot upload path (`POST /translate`) with no latency constraint — natural home
  for true offline diarization later, out of scope here.
- Research report: `plans/reports/research-diarization-260824-1835-speaker-attribution.md`

## Unresolved questions

1. arXiv 2606.08505 (2026 on-device streaming diarization, "relative minimum cluster size" for the
   new-speaker decision) — closest published analog to this setup; DER/RTF not extracted, PDF
   extraction failed. Needs a manual read before adopting the technique.
2. VoxCeleb→Vietnamese cold EER has no direct citation. Proxy only (VoxCeleb2→VN fine-tune moved
   5.98%→2.22%, implying untuned ≈6%+). Weakest-evidenced claim in the whole analysis.
3. Per-model embedding dimensions not confirmed from primary docs for every candidate.
4. No source covers the combined worst case (VN + <2s + far-field). Bench 1 is the only answer.
5. Re-cluster cadence (~20 turns) is a guess — should fall out of bench 2, not be fixed up front.
6. Whether the user accepts the 2-session recording amendment; if not, the temporal split is the floor.
