---
phase: 3
title: 'Synthesis and TTFA measurement'
status: completed
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: Synthesis and TTFA measurement

## Goal

Run every arm and record the speed and cost numbers — latency, RTF, speaking
rate, peak RSS, load time, time-to-first-audio, and stream sustain — with
enough bookkeeping that an incomplete run cannot pass as a complete one.

## Read first

- `benchmarks/tts/run_engine.py` and `run_benchmark.py` — the orchestration this
  copies, **and the two defects noted below that must not be copied**
- `benchmarks/tts/results/r2/sherpa-kokoro-en.jsonl` — row shapes
- `benchmarks/tts/tts_bench/report.py` — note `collect_runs` keys by engine alone
- `apps/api/src/modules/translate/audio/clause-splitter.ts` — **the production
  splitting rule this phase must port**

## Files to create

- `benchmarks/tts-vi/tts_vi_bench/run_engine.py`
- `benchmarks/tts-vi/tts_vi_bench/clause_split.py`
- `benchmarks/tts-vi/tts_vi_bench/report.py`
- `benchmarks/tts-vi/run_benchmark.py`

## Two defects in the vendored code that must be fixed, not copied

**Result files collide.** The original names its output `f"{engine.engine_id}.jsonl"`
inside `results/<tag>/`, and `collect_runs` keys results as `runs[tag][engine]`.
This benchmark has four arms distinguished by engine **and voice**, run over
**two sentence sets**, so both the filename and the report key would collapse
distinct runs — the VIVOS pass silently overwriting the conversational one, in a
perfectly well-formed file. Name results
`{engine}__{voice_slug}__{sentence_set}.jsonl` and key the report on that triple.
Make `run_engine` refuse to overwrite an existing result file without `--force`.

**A crashed arm leaves no trace.** The original writes its header — the only
record of `num_sentences`, `load_s`, `peak_rss_mb` — _after_ the whole loop, so an
arm that dies at sentence 30 of 90 writes no JSONL but leaves 30 WAVs on disk.
Phase 4 walks the WAV tree, so those orphans would score as a corpus WER over a
silently truncated subset. Write the header **first**, with `num_sentences` set to
the _expected_ count, and flush per sentence so a truncated file is detectable.

## Tasks & Steps

1. **Orchestrate one subprocess per (engine, voice, sentence-set) arm.** Peak RSS
   is only honest when the process holds one model, and sequential arms avoid
   contending for the same eight cores. `run_benchmark.py` takes `--run-tag`,
   `--engines`, `--sentences`, `--report-out`, and `--force`.

2. **Give `--report-out` a render-only path.** In the original, asking for a
   report re-runs the measurement — which here would overwrite the very WAVs
   phase 4 is about to transcribe. Rendering must be able to run without
   measuring.

3. **Alternate arm order between run tags.** The original runs a fixed order, so
   thermal and frequency drift lands on the same arm in both tags and is
   invisible to any r1-versus-r2 comparison. Reverse the order in `r2` and record
   the order in the header.

4. **Set `HF_HUB_OFFLINE=1` for every measured run**, so no network call can land
   inside a timed section for either engine, and a missing model is a loud
   failure rather than a slow success. Record the cache state (`warm`/`offline`)
   in the header beside `load_s`.

5. **Record the header** per arm: engine id, voice token, sentence-set name,
   `load_s`, `peak_rss_mb`, expected `num_sentences`, `sample_rate`,
   `decode_params`, arm order index, cache state, and an **environment block** —
   OS, kernel, CPU model, `onnxruntime` version, thread counts. The existing
   baselines this will be compared against were taken on Windows 11 and this
   machine is now Ubuntu, so the OS belongs in the artifact.

6. **Record per sentence**: `sentence_id`, `text`, `n_words`, `audio_s`,
   `proc_s`, `rtf`, and **`audio_s_per_word`**.

   The speaking-rate column is not decoration. `RTF = proc_s / audio_s` is
   invariant to sample rate — so the 48 kHz difference does not distort it — but
   it is **not** invariant to speaking rate: an engine that renders the same
   sentence 20% longer earns a 20% better RTF while making the user wait longer
   both to synthesize and to listen. Report **latency per word** as the headline
   speed metric, with RTF secondary and labelled as duration-normalized.

7. **Ensure the warm-up call passes the same `voice` as the timed loop**, or the
   first timed sentence absorbs a per-voice initialization cost.

8. **Measure TTFA as a separate pass, over four arms — not two.** The app does
   not synthesize whole sentences today: `clause-splitter.ts` splits translated
   text in front of the engine precisely to cut time-to-first-audio, with
   measured cuts of 23–59% recorded in its header comment and in
   `docs/development-journey.md`. Timing VieNeu whole-sentence and calling that
   its floor would overstate the incumbent roughly twofold and hand ZeroTTS a win
   it did not earn.

   Port the production rule into `clause_split.py` — boundary
   `/[,;:.!?…]+(?=\s|$)/g`, `MIN_PART_CHARS = 4` — and stop the clock at the end
   of the **first part's** synthesis. Measure:

   | Arm                   | What it is                                              |
   | --------------------- | ------------------------------------------------------- |
   | ZeroTTS streaming     | `synthesize_stream`, first audio-carrying chunk         |
   | ZeroTTS clause-split  | the drop-in swap needing no new app code                |
   | VieNeu clause-split   | **the number the verdict must beat — what ships today** |
   | VieNeu whole-sentence | context only, not the baseline                          |

   Discard the first two iterations as warm-up and take the median of the rest.
   Seed immediately before iterating the stream, per phase 1 step 5(c).

9. **Measure stream sustain alongside TTFA.** A 70 ms first chunk followed by any
   chunk generated slower than real time is an audible stall that would still
   print as "70 ms". The repo already holds itself to the opposite standard —
   `clause-splitter.ts` records that the first part's audio outlasts the time to
   synthesize the second, "so playback runs gapless". Record
   `(wall_time_at_chunk_i, cumulative_audio_seconds_i)` per chunk and report
   `max(wall_i - cumulative_audio_i)` as the underrun margin. Any run where that
   goes positive after the first chunk is a stall, and the TTFA figure must carry
   it.

10. **Write the WAVs** to
    `results/<tag>/wav/<engine>/<voice>/<sentence_set>/<sentence_id>.wav`. Phase 4
    walks this tree, so the layout is a contract. Keep each engine's native
    sample rate — resampling would hide a real product difference.

    **These WAVs come from the non-streaming decoder.** ZeroTTS runs
    `moss_audio_tokenizer_decode_full.onnx` for `synthesize()` and the
    ring-buffered `moss_audio_tokenizer_decode_step.onnx` for
    `synthesize_stream()`. If phase 1's smoke test found the two differ, also
    concatenate the TTFA pass's chunks and write them as a third ZeroTTS arm, so
    phase 4 can score the audio the TTFA claim is actually about. If they do not
    differ, record that and skip the extra arm.

11. **Run two tags** (`r1`, `r2`) over both sentence sets.
    `docs/development-journey.md` already records VieNeu as having noticeable
    spread — a 0.449 s median against a 0.873 s outlier on one sentence — with an
    explicit note that a larger sample is needed before publishing a p95.

12. **Add a completeness gate.** After a run, assert that every expected arm ×
    sentence-set × tag produced a result file whose row count matches its header's
    expected `num_sentences`, and that the WAV count matches. A failed arm may not
    abort the others, but the run must not be reportable as complete.

13. **Render `results/report-speed.md`** from all tags, both shown side by side.

## Verification

```bash
cd benchmarks/tts-vi
export HF_HUB_OFFLINE=1
for tag in r1 r2; do
  for set in conversational vivos; do
    uv run python run_benchmark.py --run-tag $tag --sentences data/sentences-$set.jsonl
  done
done
uv run python run_benchmark.py --check-complete          # gate, exits non-zero on any gap
uv run python run_benchmark.py --render-only --report-out results/report-speed.md
# every arm × sentence × tag produced a WAV
test "$(find results/r1/wav results/r2/wav -name '*.wav' | wc -l)" \
     -eq "$(uv run python -c 'import json,pathlib;print(sum(1 for p in pathlib.Path("data").glob("sentences-*.jsonl") for l in p.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")) * 4 * 2)')"
```

## Success Criteria

- [x] Result files are named per (engine, voice, sentence-set); no arm overwrites another
- [x] Headers are written before the loop with the expected sentence count, and rows flush as they go
- [x] `--check-complete` passes: every arm × set × tag present, row counts matching headers, WAV counts matching
- [x] Every arm reports latency mean/p50/p95, **latency per word**, RTF, `audio_s_per_word`, peak RSS, load time, sample rate
- [x] Headers carry the environment block (OS, kernel, CPU, ORT version, thread counts) and cache state
- [x] TTFA reported for all four arms, including **VieNeu clause-split** as the production baseline
- [x] Stream sustain (underrun margin) reported alongside ZeroTTS TTFA
- [x] Arm order alternates between `r1` and `r2` and is recorded
- [x] Whether the streaming decoder's audio differs from the non-streaming one is recorded, and if it does, its WAVs are written for phase 4
- [x] `--render-only` renders without re-measuring
- [x] A failed arm does not abort the rest, and also does not let the run report complete

## Risk and rollback

Both silent-data-loss paths — colliding filenames and orphan WAVs from a crashed
arm — produce well-formed, plausible output, which is why they are gated by
assertions rather than by care. If ZeroTTS's peak RSS lands far above the
~1–1.5 GB estimate, that is a measured finding, not a failure. Rollback is
deleting `results/`.
