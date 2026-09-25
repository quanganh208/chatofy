# Brainstorm — streaming STT, evaluated on real prod audio (2026-09-25)

Mode: `ak:brainstorm --ultra` (5 independent candidates plus 1 verifier). The winning contract is reproduced **unchanged** in section 2. The measurements and the verifier's corrections are in section 3, which should be read with it.

## 1. Headline

- **No streaming model available on CPU is better than the current stack in the per-turn architecture Chatofy uses today.**
  - The best streaming candidate, pcs (the PengChengStarling multilingual streaming Zipformer), wins only when fed one continuous recording: vi 19.0 WER vs prod 22.1.
  - Decoded per turn, as Chatofy does now, it scores **38.9**. Priming each turn with 6 s of earlier audio still leaves it at **31.6**.
- **Vietnamese: keep Zipformer-30M.** None of the other models tested beats it measurably per turn: hyntS, the 70k-hour Zipformer, Nemotron-3.5, Moonshine-vi, Whisper large-v3 and pcs.
  - The Vietnamese error rate (~22%) is high because of the audio: livestreams, slang and English code-switching.
  - Turn cutting is not the cause (prod 22.1 vs ideal cuts 23.4).
  - The two references disagree with each other by 20.4% WER, so no vi claim can yet be made with high confidence.
- **English: the largest measured gain is a batch model.** Parakeet-TDT-0.6b-v2 (int8, sherpa-onnx) scores 3.6 WER vs 7.1 in prod, at RTF 0.05–0.07.
  - The recommended shape is two-pass: Parakeet for finals, Moonshine-base kept for the 300 ms live partials.
  - This number comes from ideal cuts only, so it must be replayed on the real turn cuts before shipping.
- **Streaming is not a quality fix here.** It only helps partials stay cheap if a heavier model is adopted. A continuous recognizer per direction is the only route through which pcs could ship. It is rejected for this step because the gain (3.1 points) sits inside the reference noise.

## 2. Winning contract (candidate E, verbatim)

Date 2026-09-25. Source of truth: evidence-packet.md, plus repo reads listed at the end. Numbers not in those are marked (est.).

## 0. The challenge to the framing (read first)

The request says "find streaming models". The evidence says **streaming and quality are separate questions**, and the user has fused them:

1. **Streaming does not buy quality here.** hyntS (the streaming twin of the current vi model) scores 22.3 WER vs current-on-oracle-cuts 23.4 and prod 22.1: same thing. The vi win of pcs (19.0) comes from the model (multilingual, sees English, so the code-switched livestream decodes better), not from streaming.
2. **Turn cutting is not the vi problem.** prod 22.1 ≈ oracle 23.4. Moving to one continuous recognizer per direction fixes nothing measurable on vi. On en the cuts do matter (3 of the worst errors in the 92 s podcast were at the 8 s forced cut).
3. **The biggest measured gain is a batch model.** en: Parakeet-TDT-0.6b-v2 (batch, oracle segments) 3.6 WER vs prod 7.1. That roughly halves en WER and fits the current per-turn architecture.
4. **Streaming does matter, but as a way to save compute, not as a quality fix.** Live partials re-decode the newest window every >=300 ms. The measured per-decode cost of the current models on a 9 s buffer is 152 ms (vi) and 289 ms (en), which is just under the 300 ms floor (partial-transcript-scheduler.ts). The candidate models are 4-6x heavier (RTF 0.05-0.10 vs 0.005-0.04). Re-decoding a 9 s window with pcs would cost about 630-900 ms (est. = 9 s x RTF). That breaks the 3.3 updates/s cadence and keeps a decode lane busy all the time. **Any heavier model therefore needs its partials from somewhere else.** They can come from incremental streaming or from the current cheap model (two-pass).
5. **The vi "win" is inside the noise floor.** 22.1 -> 19.0 WER is 3.1 points, with n=4, 3/4 recordings won, and the two references disagree with each other by 20.4%. CER moves further (17.1 -> 13.2), which is more convincing but still unproven. pcs also loses on at least one entity the current model gets right: in 3c0d394a the current model has "FAN CỨNG CỦA ANH HOA LANG THANG", while pcs has "vang cứng của anh hoa luyện thang". It also loses the one recording 36.0 vs 33.8.

So the decision is really three decisions. (a) Change the en final engine? Probably yes. (b) Change the vi engine? Not proven. (c) How do partials stay affordable if a heavier model is adopted? That third one is the only place streaming belongs.

## 1. Outcome

Users see measurably better final transcripts (and therefore translations) on real Chatofy audio in both directions. Live-partial latency and cadence do not get worse, and the stack still runs on the one shared CPU host. Every engine change is backed by a paired comparison that clears the reference noise floor.

## 2. Constraints

- CPU-first, one host: i7-11700K 8C/16T, 31 GB RAM. The STT sidecar has 4 threads and must serve 2 concurrent decodes (the vi and en engines are each locked). It shares the box with dev+prod, TTS and MT.
- No GPU now. Renting one is a whole-speech-stack decision (STT+TTS+MT), taken only on a marked quality gain. Off-box GPU training is allowed.
- Non-commercial thesis, so NC licenses are fine, but any commercialisation blocker must be flagged. pcs has no declared license (UNVERIFIED). The current vi model and hyntS are CC-BY-NC-ND. Parakeet-TDT and Moonshine are permissive (Parakeet license per its model card, not re-checked here).
- Decisions come from numbers. Treat any WER delta < ~2-3 points on vi as noise.
- Existing contracts must survive or be consciously replaced:
  - per-conversation hotword biasing on vi (services/local-stt/hotwords.py; it fixes "giải POKER"/"siêu thị TARGET", and a standing list was measured harmful);
  - `server.transcript.partial` cadence (>=300 ms floor, 3.33/s);
  - translation partials for turns >3 s;
  - per-turn speaker attribution (CampPlus, kMax=2);
  - the client 8 s ceiling with 1.5 s pause-seeking lookahead.
- Output format matters downstream. The current vi model outputs uppercase with no punctuation, and pcs outputs lowercase vi with no punctuation (parity). The current en model (Moonshine) emits punctuation and casing. pcs-en emits UPPERCASE with no punctuation, which would be a regression for MT input. Parakeet-TDT v2 emits punctuation and casing (per its model card, not verified on this box).

## 3. Non-goals

- Renting a GPU or any GPU-only model (Voxtral-Realtime, Parakeet-unified-en streaming at RTF 1.7).
- Cloud STT in the product path (ElevenLabs is used only as a reference).
- Re-architecting to one continuous recognizer per direction, unless gap G6 proves per-turn streaming is inadequate (see below).
- Adding punctuation restoration for vi (no known sherpa model; separate question).
- Fine-tuning in this step. It is a research track (option E) and only gets opened if G1-G3 show pcs is not clearly better.
- Changing speaker attribution, TTS or MT.
- Reviving sliding-window stitching (already rejected: stitching wrong 15% vi / fails 37% en).

## 4. Acceptance criteria (observable, numeric, with how to measure)

| #   | Criterion                 | Threshold                                                                                                                                                                                                           | How measured                                                                                                                                                                                                                              |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | vi final quality          | Candidate beats prod-current on **both** references (EL Scribe v2 and PhoWhisper-large). Paired segment-bootstrap 95% CI on the WER delta excludes 0, and on CER too. Point estimate >=3 WER points better.         | Align each hypothesis to the reference word timestamps (Levenshtein over words), cut into reference segments, run 10k paired bootstrap resamples. Corpus is the existing 4 vi recordings plus >=6 new real sessions (target >=30 min vi). |
| A2  | vi ground truth           | On a human-corrected gold subset (>=5 min, drawn across all vi recordings), the candidate is no worse than current by more than 1 WER point, and better if A1 claims better.                                        | The maintainer hand-corrects EL output for the subset, then both systems are scored against that gold.                                                                                                                                    |
| A3  | vi entities / code-switch | The hotword repro cases (POKER, TARGET) come back right with biasing. On the named entities in the corpus (e.g. Quyên, Hoa Lang Thang, fan cứng), the entity hit-rate is >= current.                                | Existing test_hotwords + app flow with the candidate engine, plus a tally of the entity list in the recordings.                                                                                                                           |
| A4  | en final quality          | WER <= 5.0 vs Whisper-large-v3 on prod en (currently 7.1), confirmed by a second reference: ElevenLabs if approved, or a >=3 min human gold. Measured on **real turns** (turns.tsv cuts), not only oracle segments. | Same scorer, with the prod cut boundaries replayed.                                                                                                                                                                                       |
| A5  | Final latency             | Turn end -> final transcript p95 <= current p95 + 300 ms, for 8 s turns, with 2 concurrent decodes and partials running.                                                                                            | Sidecar/API timing logs over a replay of the 6 recordings, two directions at once.                                                                                                                                                        |
| A6  | Live partials             | First partial words p50 <= 800 ms after speech onset (current ~630 ms) in the real browser path. Cadence >= 3 updates/s on a 9 s turn. Shown-text rewrite rate <= current's (baseline must be measured).            | Browser e2e with timestamps (web app), plus scheduler logs.                                                                                                                                                                               |
| A7  | Compute headroom          | With 2 engines decoding, partials, TTS and MT under load: no partial tick is skipped for lane starvation beyond the current rate, and per-stream effective RTF p95 <= 0.3 (threshold est., tighten after baseline). | Replay load test on the host; count scheduler skips.                                                                                                                                                                                      |
| A8  | Memory                    | Sidecar peak RSS <= current + 1.5 GB (budget est.).                                                                                                                                                                 | `/proc/<pid>/status` VmHWM during A7.                                                                                                                                                                                                     |
| A9  | License                   | pcs license declared in writing by PCL-Voice/sherpa-onnx, or maintainer explicitly accepts "undeclared, thesis-only" and records it in docs.                                                                        | GitHub issue / model card, plus an entry in the docs decision log.                                                                                                                                                                        |
| A10 | Regression safety         | Engine choice sits behind the existing engines/registry. Rollback is a config flip. services/local-stt tests plus API/web specs are green.                                                                          | CI.                                                                                                                                                                                                                                       |

## 5. Approaches and trade-offs

**A. Targeted swap, current architecture untouched (en final engine only, plus en cut fix)**

- What: Parakeet-TDT-0.6b-v2 becomes the en final decoder. Moonshine-base stays for en partial re-decodes (cheap, 289 ms at 9 s). vi is unchanged. Separately, measure whether raising the en ceiling or improving the forced-cut rule removes the cut errors.
- Cost: low. One engine class in services/local-stt/engines. The partial and final paths already call the sidecar separately, so they choose engines separately.
- Final-latency cost: 8 s x 0.05-0.07 ~ 0.4-0.56 s vs ~0.29 s now (est.).
- Assumption it depends on most: the Parakeet oracle-segment gain (3.6 vs 7.1) survives real cuts and a non-Whisper reference.
- Fails first if: Parakeet and Whisper share error biases (a single reference with n=2), or Parakeet degrades on hard-cut fragments the way Moonshine did.
- Worst plausible case: en gain shrinks to within noise, you have spent ~1-2 days, and you revert via registry.
- Does nothing for vi, which is the user's main complaint.

**B. Two-pass per turn: cheap model for partials, best model for finals (both languages)** — _recommended shape_

- What: partials keep the current cheap models (Zipformer-30M vi, Moonshine-base en) and the existing re-decode scheduler, unchanged. Finals go to the better engine: pcs for vi (if A1-A3 pass) and Parakeet-TDT for en.
- Final-latency cost: an 8 s vi turn at RTF 0.07-0.10 adds ~0.4-0.65 s (est.). If that fails A5, feed pcs incrementally in the background as audio arrives, so the final is ready ~1 chunk after turn end. That keeps the same per-turn contract and just makes the sidecar stateful for the final pass only.
- Assumption it depends on most: the pcs vi gain is real, not reference noise (G1/G2), and it survives per-turn fresh-state decoding (it was measured continuously; G3).
- Fails first if: the bootstrap CI straddles 0, or per-turn pcs loses its advantage because it had cross-turn left context in the continuous run. Then vi stays on the current model and B collapses to A.
- Second-order effects:
  - A partial can visibly change at finalisation because two different models disagree. There is a "partial said X, final says Y" flip. This already happens with re-decode, but now the vocabulary differs (lowercase vs uppercase, code-switched English words appear only in the final).
  - Hotword biasing must be re-implemented on pcs (G4), or code-switched hotwords regress.
  - RAM: two vi models resident (est. +325 MB for pcs, measured folder size).
- Worst plausible case: +0.6 s final latency on long vi turns, no significant quality gain, and the vi change reverted. Cheap to abandon (registry flag).

**C. Per-turn incremental streaming for partials AND finals (the user's "streaming model", scoped to a turn)**

- What: the sidecar holds one online stream per active turn (pcs vi, pcs or Nemotron-1120 en). Audio chunks are pushed as they arrive. Partials are the stream's current hypothesis (0% rewrite measured), and the final is the stream at endpoint. The re-decode scheduler for those engines goes away.
- Compute: linear, not quadratic (RTF 0.07-0.10 total).
- Assumption it depends on most: first-partial latency and per-turn accuracy are acceptable.
- Fails first if: ttft regresses. pcs ttft_p50 was 1.28 s on clean clips (this includes leading silence, so it is an upper-bound signal) vs ~630 ms now, and chunk-16 look-ahead is structural. Or it fails if en quality/format regresses: pcs-en is UPPERCASE with no punctuation, and Nemotron 1120 is 5.5 WER, better than prod 7.1 but worse than Parakeet 3.6.
- Second-order effects:
  - Stateful sidecar sessions (a new protocol: WebSocket or session ids).
  - Lane accounting changes, since a stream occupies a lane for the whole turn.
  - Hotwords must work on the online recognizer.
  - Translation partials must key off stream updates.
  - Speaker attribution unchanged (still per turn).
- Worst plausible case: ~1-2 weeks of protocol work (est.), live feel slower than today, en punctuation lost. Medium-high cost to abandon.

**D. Continuous recognizer per direction, no ASR turn cuts (the literal "switch to streaming")**

- Assumption it depends on most: cutting is a dominant error source. **The evidence contradicts this for vi (prod 22.1 ≈ oracle 23.4).** It is only partly true for en, where a cheaper fix exists (A).
- Fails first on:
  - speaker attribution, which needs turn segments;
  - translation turn boundaries;
  - the 8 s ceiling semantics;
  - long-session state drift.
- Worst plausible case: a large re-architecture, a regression in speaker/translation boundaries, and a vi quality gain no bigger than B's. **Reject for now.**

**E. Off-box fine-tune of a streaming Zipformer (hyntS or pcs) on conversational/code-switched vi (GigaSpeech2-vi, VietSpeech, VLSP)**

- Assumption it depends on most: domain data exists that matches livestream slang and code-switching, and the gain beats pcs.
- Fails first if: training data is read or clean speech (the VIVOS-style gain that does not transfer; clean and prod rankings already disagree).
- Worst plausible case: weeks of GPU time for an unmeasurable gain against a 20% noise floor.
- Only worth opening once G1/G2 give a reliable yardstick. Without that you cannot tell whether it worked.

**Worst cases compared**

|     | Cost       | Worst plausible case                                  | Cost to abandon          |
| --- | ---------- | ----------------------------------------------------- | ------------------------ |
| A   | smallest   | wasted ~1-2 days                                      | trivial                  |
| B   | small      | +0.6 s final latency, no vi gain                      | trivial (flag)           |
| C   | medium     | slower live feel, en format loss, ~2 weeks            | moderate                 |
| D   | largest    | regressions across speaker/translation for no vi gain | high                     |
| E   | open-ended | GPU spend, unverifiable result                        | medium (money, not code) |

## 6. Better approaches

Yes. The implied approach was "switch to a streaming model". The better approach is to **decouple the final engine from the partial engine (two-pass, option B) and swap engines per language on evidence**. Streaming stays in reserve as the compute fix for partials (C), used only if the cheap-partial path fails A5/A6. The evidence for this:

- hyntS streaming ≈ current batch, so streaming alone gives no quality.
- prod ≈ oracle on vi, so cutting is not the vi bottleneck.
- en's best number is a batch model (Parakeet 3.6).
- The measured re-decode cost table shows heavier models cannot serve partials by re-decode, but the cheap current models already do, at 3.33/s.

A second improvement is **fix the yardstick before the model**. At a 20.4% inter-reference disagreement with n=4, no vi model choice is defensible yet. A paired bootstrap on the existing JSONs costs zero new audio, and a 5 min human gold subset settles which reference to trust. Together they are cheaper than any integration.

## 7. Recommended direction

Smallest approach satisfying the contract, ordered cheapest-to-abandon first:

1. **Measure first, no product code** (close G1, G2, G3, G4, G5; about a day or two, est.).
   - Bootstrap CI on the existing JSONs.
   - A human gold subset.
   - pcs decoded per-turn on turns.tsv boundaries.
   - A pcs hotword test.
   - Parakeet on real en turns.
2. **Ship A** (Parakeet-TDT en final, Moonshine-base kept for en partials) behind the engine registry, if A4/A5 pass. This is the highest-confidence gain in the packet.
3. **Extend to B for vi** (pcs finals, current Zipformer-30M partials) **only if** A1-A3 and A9 pass. Otherwise vi stays as is, and the honest conclusion is that no available CPU model is measurably better on this audio. That points to E as a research track, not a product change.
4. **Escalate to C only if** B's final latency fails A5 even with background incremental feeding, or the partial/final flip is judged worse than a slower first partial. Do not start D.

This keeps every step reversible by a registry flag until step 4. It spends effort in proportion to evidence strength (en strong, vi weak). It also answers "evaluate more rigorously" before answering "which model".

## 8. Evidence gaps to close before committing

| Gap                                     | Why load-bearing                                                    | Concrete measurement                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Significance                         | The vi delta is 3.1 WER with n=4, below or at the noise floor       | Word-align each system to EL word timestamps, then do a segment-level paired bootstrap (10k) of WER/CER deltas, pcs vs prod and pcs vs cur-oracle, vs EL and vs PhoWhisper separately. Report the 95% CI. Uses the existing convs/*.json only. Then add >=6 new real vi sessions and repeat. |
| G2 Reference validity                   | EL vs PhoWhisper disagree by 20.4% WER; the ranking could flip      | Hand-correct >=5 min of vi (stratified across the 4 recordings plus the code-switch segments). Score all systems against the gold and check that the rank order matches the EL ranking.                                                                                                      |
| G3 pcs per-turn                         | pcs was measured continuously; B/C decode per turn with fresh state | Run pcs with a fresh stream per prod turn (turns.tsv boundaries) and per oracle segment. Compare with its continuous 19.0.                                                                                                                                                                   |
| G4 pcs hotwords                         | Losing biasing reopens the POKER/TARGET defect                      | sherpa online recognizer with modified_beam_search plus a hotwords file on the pcs bpe vocab, run on the two repro clips. Check that it neither misses the terms nor over-biases (WER on the same conversation within ±0.5).                                                                 |
| G5 Parakeet on real cuts, second en ref | The en gain is oracle-only against a single Whisper reference       | Decode the prod en turns (turns.tsv) with Parakeet. Get a second reference: ElevenLabs on the 2 en files (needs approval) or a >=3 min human gold.                                                                                                                                           |
| G6 Latency/compute under contention     | RTFs were measured single-stream, sequentially                      | Replay load: 2 directions concurrently, partial scheduler on, TTS running. Log turn-end->final p50/p95, first-partial latency, scheduler skips, VmHWM. Run for current, A and B.                                                                                                             |
| G7 Downstream MT effect                 | Users see translations, not WER                                     | Translate prod-current vs candidate transcripts per turn with the prod MT. Compare against a translation of the gold/EL text (LLM judge or COMET, pick one and fix it before looking).                                                                                                       |
| G8 pcs license                          | Undeclared = all rights reserved by default                         | Ask upstream (PCL-Voice repo issue, sherpa-onnx model page). Record the answer or the maintainer's explicit acceptance.                                                                                                                                                                      |
| G9 en forced cuts                       | 3 worst en errors sat on the 8 s cut                                | Count forced cuts vs pause cuts in the prod en turns. Replay with ceiling 10-12 s and measure WER plus the latency cost.                                                                                                                                                                     |

## 9. Unresolved questions

1. What is the success metric the user will judge by: final transcript, live partial feel, or translation quality? This decides whether B's partial/final flip is acceptable.
2. Is the maintainer willing to hand-correct ~5 min of vi (G2)? Without a gold subset, the vi decision stays within noise.
3. Approval to send the 2 en recordings to ElevenLabs as a second reference?
4. Is an undeclared-license model (pcs) acceptable for the thesis defence record, or must every shipped weight carry an explicit license?
5. What final-latency increase is tolerable? A5 assumes +300 ms p95.
6. Can more real vi sessions be recorded soon (target >=30 min), and should they deliberately cover code-switching, slang and phone audio?
7. Should one multilingual model (pcs for both directions) be valued for simplicity despite losing en punctuation? My read: no, because Parakeet with punctuation and casing is a better en final.

Repo reads grounding this:

- apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts (the per-decode cost table and the 300 ms floor)
- services/local-stt/hotwords.py and engines/zipformer_vi.py (per-conversation biasing via modified_beam_search)
- engines/registry.py (engine swap point)
- apps/web/src/hooks/use-streaming-translate.ts and apps/extension/src/direction-session.ts (MAX_UTTERANCE_MS=8000)
- packages/realtime-client/src/audio/speech-gate.ts (CUT_LOOKAHEAD_MS=1500)
- convs/3c0d394a.*.json (the pcs vs current entity example)

## 3. Appendix — measurements and corrections (controller + verifier)

### 3.1 Data and references

- **Recordings:** all 6 prod conversations that have a recording were evaluated: 4 vi→en (~9.2 min) and 2 en→vi (~3.1 min). The other 10 conversations have no audio.
- **vi reference:** ElevenLabs Scribe v2, approved by the maintainer, cross-checked against PhoWhisper-large locally. The two disagree with each other by **20.4% WER / 13.6% CER**. Whisper large-v3 was shown to be unreliable on vi (for example "vang cứng" for "fan cứng").
- **en reference:** Whisper large-v3 only.

### 3.2 Results on prod audio (WER / CER %, RTF at 4 threads)

| vi, vs ElevenLabs (vs PhoWhisper-large)     | continuous             | per turn           | per turn, primed 6 s | RTF         |
| ------------------------------------------- | ---------------------- | ------------------ | -------------------- | ----------- |
| prod (current Zipformer-30M + real cuts)    | —                      | 22.1 / 17.1 (24.0) | —                    | ~0.01       |
| current Zipformer-30M, ideal cuts           | —                      | 23.4 / 18.6 (24.5) | —                    | 0.005–0.02  |
| Zipformer vi 70k h (offline)                | —                      | 23.1 / 18.2 (24.7) | —                    | 0.005–0.02  |
| pcs (streaming, multilingual)               | **19.0 / 13.2** (22.0) | 38.9 / 32.7 (39.0) | 31.6 / 25.8 (33.2)   | 0.07–0.10   |
| hyntS (streaming twin of the current model) | 22.3 / 16.8 (23.2)     | 28.4 / 22.8        | 31.6 (primed 3 s)    | 0.02–0.04   |
| Moonshine streaming tiny-vi                 | 37.4 / 26.6            | —                  | —                    | 0.10–0.22   |
| Nemotron-3.5 streaming 1120 / 560 ms        | 44.1 / 46.8            | —                  | —                    | 0.08 / 0.12 |
| Whisper large-v3 (batch)                    | 28.3 / 22.8            | —                  | —                    | slow        |

| en, vs Whisper large-v3                   | continuous       | per turn      | RTF                             |
| ----------------------------------------- | ---------------- | ------------- | ------------------------------- |
| prod (Moonshine-base + real cuts)         | —                | 7.1 / 5.3     | ~0.02                           |
| Moonshine-base, ideal cuts                | —                | 9.9 / 8.8     | 0.02–0.04                       |
| **Parakeet-TDT-0.6b-v2 int8**             | —                | **3.6 / 4.0** | 0.05–0.07                       |
| pcs                                       | 3.8 / 2.9        | 7.4 / 5.4     | 0.08–0.11                       |
| Parakeet-unified streaming 560 ms         | 4.8 / 6.0        | —             | **1.7 (slower than real time)** |
| Nemotron-3.5 1120 ms                      | 5.5 / 4.1        | —             | 0.08                            |
| Moonshine streaming medium / small / tiny | 6.7 / 8.4 / 12.2 | —             | 0.61 / 0.47 / 0.33              |
| nemotron-speech-streaming-en 560 ms       | 10.9 / 6.5       | —             | 0.13–0.16                       |

The pcs-en primed rows (15–20 WER) are omitted as a probable prefix-stripping artifact.

- **Clean read speech (VIVOS / LibriSpeech, 50 utterances each):** current Zipformer 5.38, hyntS 6.99, pcs-vi 13.44; Moonshine-base en 3.86, pcs-en 6.39.
  - The clean-speech ranking and the prod-audio ranking **disagree**. Clean benchmarks are not a valid proxy for this product.
- **Streaming behaviour (pcs / hyntS):** shown text is rewritten 0% of the time; first text p50 appears after 1.0–1.6 s of audio on clean clips. Moonshine-vi rewrites 12% (p50).

### 3.3 Verifier corrections to the winning contract (apply when planning)

1. **Gap G3 is closed, negatively.** pcs per turn scores 38.9 (primed 6 s: 31.6) vs 19.0 continuous; hyntS scores 28.4 per turn. Per the contract's own fails-first clause, approach B collapses to A. **vi stays on Zipformer-30M.**
2. **Approach C (per-turn incremental streaming) has no viable candidate** among the measured models.
3. **Approach D (continuous recognizer) is now the only route by which pcs could ship.** It stays rejected for this step, because its gain (3.1 points) is within noise and it would disrupt speaker attribution and turn semantics.
4. **Memory budget A8:** the 4 GB container is shared with TTS (~2 GB), and both current engines take ~640 MB, so real headroom is ~1.3 GB. Use this criterion instead: sidecar peak RSS + TTS peak ≤ 3.6 GB (VmHWM).
5. **Two-pass needs an API field.** `/transcribe` accepts only `file`, `language` and `hotwords[]`, so it needs a `mode` or `engine` field. Do not add a pseudo-language, because the language enum is closed on purpose.
6. **G5 is the critical path.** Parakeet's 3.6 comes from ideal cuts against a single reference, so it must be replayed on the real prod turn cuts, with a second en reference.
7. **The pcs vs current entity example** ("Hoa Lang Thang") comes from the per-recording outputs, not from the evidence packet.
8. **Lane count:** the code default is `LOCAL_STT_CONCURRENCY=4` lanes per engine, but the packet says 2 concurrent decodes. Reconcile these with the prod env before any load test.
9. **hyntS is CC-BY-NC-ND,** which forbids distributing a fine-tuned derivative. Fine-tuning (option E) must start from a model with a known license, or from scratch.

### 3.4 Ranking

| candidate      | faithful | evidence | acceptance criteria | unknowns | conditional fields | addendum robustness | total   |
| -------------- | -------- | -------- | ------------------- | -------- | ------------------ | ------------------- | ------- |
| **E (winner)** | 18       | 17       | 18                  | 18       | 19                 | 19                  | **109** |
| C              | 17       | 17       | 17                  | 18       | 18                 | 18                  | 105     |
| B              | 16       | 18       | 18                  | 19       | 18                 | 16                  | 105     |
| A              | 17       | 18       | 17                  | 18       | 18                 | 16                  | 104     |
| D              | 17       | 16       | 17                  | 18       | 17                 | 17                  | 102     |

- All five candidates converged on the same core: measure first, decide per language, gate on per-turn results, and defer the continuous architecture.
- E won on the realism of its ship item (Parakeet two-pass for en), which is untouched by the per-turn finding.
- The per-turn result was measured after the candidates were written. The verifier used it as a post-dispatch addendum.

### 3.5 Reproduce

Scripts are in `benchmarks/stt/scripts/prod-audio-arms/` (see its README). Clean-set results are in `benchmarks/stt/results/r10-prod-audio/`. No prod audio or transcripts are committed.

### 3.6 Follow-up (2026-09-25, after acceptance): gates measured on the REAL turn cuts

- **Replay:** the 6 recordings were fed through the real `CapturePump` with prod options (`continuous`, `fullDuplex`, 8 s ceiling). The replay matches the prod log exactly for bcf4d748: 17 turns, 8 forced cuts.
- **Replay fidelity:** the current engines score vi 22.3 / en 7.4 on the replayed turns, against the saved prod text at 22.1 / 7.1.
- **Whole-text WER on replayed turns:**
  - vi: current 22.3, Zipformer-70k 21.9, pcs 35.8.
  - en: Moonshine 7.4, **Parakeet-TDT 3.4**.
- **Paired per-turn bootstrap** (10k draws; reference words attributed to turns by midpoint):
  - en Parakeet − Moonshine = **−4.0, 95% CI [−7.3, −0.9]**;
  - vi Zipformer-70k − current = −0.3 [−1.9, +1.3];
  - vi pcs − current = **+13.7 [+8.9, +18.8]** (worse).
- **Load test** on a local sidecar (two directions at once, a partial every 300 ms): en final p95 went from 215 to 351 ms, en partial p95 stayed at 191 ms, there were no 503s, and peak RSS rose from 721 to 1,476 MB against a 4 GB limit. STT and TTS have separate `mem_limit`s, which corrects appendix item 4.
- **Decision:** ship approach A (Parakeet for en finals, Moonshine for en partials); vi unchanged. Plan: `plans/260925-1159-parakeet-en-final-pass/plan.md`.

## Unresolved questions

1. Will the maintainer accept "vi stays as is; en ships Parakeet two-pass" as this step's outcome, given that the complaint was framed around vi?
2. Will the maintainer hand-correct ~5 min of vi into a gold reference? Without it, vi decisions stay inside a 20% reference noise floor.
3. Approval to send the 2 en recordings to ElevenLabs as a second reference, for gap G5?
4. Is an undeclared-license model (pcs) acceptable if the continuous architecture is ever opened?
5. Should the vi improvement be pursued as a fine-tuning research track, on conversational and code-switched vi with an off-box GPU? It is worth opening only once a trustworthy vi yardstick (gap G2) exists.

ultra: picked=2/5 margin=low unanimous=no rejected_all=no
