---
title: 'Re-run on equal terms — both engines seeded, both streaming'
date: 2026-09-15
harness: benchmarks/tts-vi/
parent: plans/reports/benchmark-260914-1720-vieneu-sampler-and-streaming.md
supersedes: plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md (speed, TTFA, reproducibility)
verdict: keep VieNeu, and stream it
---

# Re-run on equal terms

The 17:20 report found that `vieneu` has a sampler and a streaming API the
harness did not know about, and left the main run standing on an asymmetry: one
engine seeded, one not; one engine's time-to-first-audio measured as a stream,
the other's as clause-split synthesis. This is that run redone with the
asymmetry removed, at the request to make streaming the thing being measured
because the product is aiming at realtime with no delay.

**Verdict: keep VieNeu, and switch the app to its stream.** On this CPU VieNeu
reaches _gapless_ audio in 221–257 ms against ZeroTTS's 937–1281 ms, and
ZeroTTS underran on **every stream it produced, 164 of 164**. The intelligibility
advantage ZeroTTS holds is real and unchanged, and it is now the only dimension
on which it leads.

## What changed in the harness

| Change                                                          | Why it was load-bearing                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vieneu_vi.py` seeds before every call                          | Unseeded, every VieNeu figure was one draw from a distribution presented as a measurement                                                            |
| `vieneu_vi.py` implements `synthesize_stream` on `infer_stream` | Its TTFA was previously measured as clause-split synthesis in front of an API that streams                                                           |
| `SEED` moved to `measure.py`                                    | Both engines draw from it now; seeding one of two compared engines produced the false reproducibility contrast                                       |
| `run_engine.py` warms the streamed path too                     | Warming only `synthesize` left the streamed decoder's first-call cost inside the first measured `stream_ttfa_s` — the number the comparison turns on |
| `seed_sensitivity.py` sweeps seeds on both engines              | It measured VieNeu by bare repeats; after the fix those repeats would have re-seeded identically and reported a spread of exactly zero               |

The unseeded run's per-arm JSONL is kept in `results/unseeded-baseline/`, because
the three earlier reports quote it and the re-run overwrote `results/r1` and
`results/r2` in place.

## Time to first audio — the reason for the re-run

Conversational set, 41 sentences, medians in ms. `gapless start` is the first
chunk plus the worst the stream then fell behind: what a player must buffer
before it can run to the end without stalling.

| Arm                 | first chunk |   underrun p50 | underrun worst | **gapless start** | streams that starved |
| ------------------- | ----------: | -------------: | -------------: | ----------------: | -------------------: |
| VieNeu / Mai Anh    |     248–257 |       −111…−92 |      +222…+350 |       **248–257** |            6–9 of 41 |
| VieNeu / Thanh Bình |     221–251 |       −119…−99 |       −17…+141 |       **221–254** |            0–5 of 41 |
| ZeroTTS / baotrang  |     144–148 | **+796…+1134** |    +1245…+2140 |      **937–1281** |         **41 of 41** |
| ZeroTTS / quangminh |     148–153 | **+834…+1028** |    +1790…+2351 |     **1001–1184** |         **41 of 41** |

ZeroTTS reaches the first sample about 100 ms sooner and then cannot keep up: its
median stream runs dry for eight tenths of a second to over a second, and not one
of its 164 streams stayed ahead of the listener. VieNeu's median stream runs
_ahead_ by about 100 ms and reaches gapless audio four to five times faster.

Against what the app waits for today — VieNeu clause-split, 781–1193 ms — the
same engine's own stream is **three to five times faster**. That gain needs no
engine swap. It needs the sidecar to call `infer_stream`.

The p95 tells the same story: VieNeu 321–497 ms, worst single sentence 752 ms;
ZeroTTS 1333–2195 ms, worst 2564 ms.

## Speed — VieNeu wins by more than before

Conversational set, both tags.

|                            |              VieNeu |             ZeroTTS |
| -------------------------- | ------------------: | ------------------: |
| RTF                        |   **0.497 – 0.641** |       0.865 – 0.977 |
| p50 per sentence           |   **1.26 – 1.86 s** |       2.09 – 2.41 s |
| Latency per word           | **0.110 – 0.164 s** |     0.182 – 0.209 s |
| Load time                  |   **1.72 – 1.83 s** |       4.09 – 4.54 s |
| Peak RSS                   |  **1544 – 1622 MB** |      1647 – 1702 MB |
| Speaking rate (audio/word) |     0.221 – 0.256 s | **0.207 – 0.222 s** |

Both engines now also synthesize a full extra stream per sentence on this set, so
the machine is doing more work per arm than in the unseeded run; the comparison
between arms is unaffected because both carry the same load.

## Run-to-run reliability — a tie, and now measured rather than assumed

With both engines seeded, r1 and r2 are **bit-identical**: 41/41 per arm on the
conversational set and 50/50 on VIVOS, produced by separate processes. The
original report's "ZeroTTS 41/41, VieNeu 0/41" was the harness, not the engines.

Two details worth keeping:

- VieNeu's **streamed** output is not bit-identical at a fixed seed, but the
  difference is at most **1.5e-06** (≈ −116 dBFS, below a 16-bit LSB) with the
  acoustic tokens identical. The cause is in the package: `infer_stream` decides
  how many frames to buffer per chunk from `time.perf_counter()`, so chunk
  boundaries follow machine speed. Written as PCM_16 the outputs agree, and this
  is the same order as the 3.87e-06 already measured between ZeroTTS's two
  decoders.
- With synthesis pinned and the WAVs proven identical, WER still moved **0.2pp**
  between tags (baotrang 6.78 → 6.98, Thanh Bình 14.78 → 14.99). That is the ASR
  judge's own nondeterminism, and it bounds how small a WER difference this
  harness can claim.

## Intelligibility — ZeroTTS still wins, and the seed matters more than the run

At the shared seed, conversational set, PhoWhisper-small (human-speech floor
7.71%):

| Arm                 | WER r1 | WER r2 | vs VieNeu, paired bootstrap          |
| ------------------- | -----: | -----: | ------------------------------------ |
| ZeroTTS / baotrang  |  6.78% |  6.98% | −22.4pp, CI [−41.3, −6.9], separates |
| ZeroTTS / quangminh |  6.78% |  6.78% | −8.0pp, CI [−14.3, −3.0], separates  |
| VieNeu / Mai Anh    | 29.16% | 29.16% | —                                    |
| VieNeu / Thanh Bình | 14.78% | 14.99% | —                                    |

**Do not quote the 22.4pp figure as the gap.** Seed 20260914 is an unusually good
draw for ZeroTTS and an unusually bad one for VieNeu's female voice. The seed
sweep already on file says so:

| Voice               |   min | median |   max | spread | where the shared seed falls      |
| ------------------- | ----: | -----: | ----: | -----: | -------------------------------- |
| zerotts / baotrang  |  6.98 |  10.27 | 36.34 | 29.4pp | its **best** of 8                |
| zerotts / quangminh |  4.31 |   7.60 | 17.04 | 12.7pp | 4th of 8                         |
| vieneu / Mai Anh    | 16.43 |  21.97 | 36.96 | 20.5pp | 6th of 7 with today's draw added |
| vieneu / Thanh Bình | 12.73 |  16.63 | 30.39 | 17.7pp | near the good end                |

Median against median, the gap is roughly **10pp female** and **9pp male** —
which is what the first report said. The direction is stable across every way of
slicing it; the magnitude at any one seed is not. VIVOS agrees in direction and
does not separate on either gender (CI spans zero both times).

The two discounts on this leg still stand: ZeroTTS's voices were picked for their
"rõ ràng" labels while VieNeu's were picked by ear for naturalness, and nothing
has measured naturalness on either engine.

## Where the verdict now stands

| Dimension                            | Winner                      | Separated?                                  |
| ------------------------------------ | --------------------------- | ------------------------------------------- |
| Time to first gapless audio          | **VieNeu, 4–5×**            | Yes, ranges nowhere near overlapping        |
| Stream stability                     | **VieNeu**                  | Yes — ZeroTTS starved on 164 of 164 streams |
| Synthesis speed, load time, peak RAM | **VieNeu**                  | Yes                                         |
| Run-to-run reliability               | tie                         | Both bit-identical under a seed             |
| Intelligibility                      | **ZeroTTS**, ~9–10pp median | Yes on conversational, no on VIVOS          |
| Naturalness                          | not measured                | —                                           |
| Licence                              | tie                         | Apache-2.0 and MIT                          |

For a product whose stated target is realtime with no delay, the dimension that
decides it is the first row, and it does not favour the challenger. ZeroTTS
cannot stream Vietnamese on this CPU without stalling — not occasionally, but on
every stream measured.

## What to do next, in the product

The app currently splits translated text into clauses and calls `infer` per
clause (`apps/api/src/modules/translate/audio/clause-splitter.ts`,
`services/local-tts/engines/vieneu_vi.py`). The splitter exists precisely to work
around a streaming API the engine turns out to have. Calling `infer_stream`
instead cuts the measured wait from 781–1193 ms to 221–257 ms.

Two things to settle before that lands, neither measured here: whether the
sidecar's HTTP contract can carry a stream to the API and on to the client, and
whether clause splitting still earns its place in front of a streaming call or
becomes redundant. The sidecar should also seed its own call, for the same reason
the benchmark does.

## What this run does not establish

- **Naturalness**, on either engine. The `benchmarks/mos` panel is still the only
  way to settle it, and it is now a quality baseline for the incumbent rather
  than the gate on a swap.
- **That the shared seed is representative.** It is reproducible, which is a
  different property; the seed sweep is the evidence about level.
- **Streamed-audio WER**, directly. It is inferred from whole-path WER via the
  measured equivalence between each engine's two decoders (1.5e-06 and 3.87e-06
  peak delta), which is why no third scoring arm exists.
- **Anything about a GPU.** Every figure here is CPU, 8 threads, onnxruntime
  1.27.0, Ubuntu.

## Unresolved questions

- Should the seed sweep be re-run on a set of **shared** seeds now that both
  engines take one? It is the only way to compare distributions rather than
  draws, and it is the measurement the intelligibility verdict actually rests on.
  Cost is roughly 40 minutes per three seeds per voice, including ASR.
- VieNeu / Mai Anh sits at a 21.97% median WER against baotrang's 10.27%. If the
  female voice is the weak point rather than the engine, is auditioning VieNeu's
  other presets cheaper than a swap?
- `score_intelligibility.py` declares an `--out` argument that nothing reads.
  Remove it or implement it?
