---
title: 'VieNeu has a sampler and a streaming API — two harness errors that shaped the verdict'
date: 2026-09-14
harness: benchmarks/tts-vi/
parent: plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md
verdict: the swap case largely collapses; keep VieNeu
---

# VieNeu has a sampler, and it streams

Executing the roadmap's Priority 1 — find out why the incumbent varies run to
run — turned up two facts about `vieneu` that the harness did not know. Each
invalidates a load-bearing claim in the main report, and both favour the
incumbent.

## 1. The variance was never uncontrollable

The main report calls this its most product-relevant finding:

> _"VieNeu has no sampler at all and is still not byte-reproducible — 0 of 41
> outputs identical across two runs. Why remains unexplained."_

`Vieneu.infer` takes `temperature=0.8, top_k=25, top_p=0.95,
repetition_penalty=1.2`. **Those are the same sampling defaults ZeroTTS uses.**
VieNeu has a sampler, it draws from numpy's global RNG, and nothing seeds it.
That is the whole of the mystery.

`scripts/check_vieneu_seeding.py`, 8 sentences × 2 voices:

|                                                   | Mai Anh | Thanh Bình |
| ------------------------------------------------- | ------: | ---------: |
| unseeded, reproducible                            |     0/8 |        0/8 |
| seeded before each call, same process             | **8/8** |    **8/8** |
| seeded before each call, **across two processes** | **8/8** |    **8/8** |

Greedy decoding (`top_k=1`, or `temperature→0`) pins it too, at a different but
equally stable output.

The fix is the one `engines/zerotts_vi.py` already applies to the challenger, and
for a reason its own docstring spells out: _"Unseeded, every latency, RTF, TTFA
and WER figure is one draw from a distribution rather than a measurement."_ That
argument is engine-independent. It was applied to one of the two engines because
the adapter believed the other had no sampler, and `decode_params()` records that
belief as fact: `"seed": None, "stochastic": False`.

So the reproducibility contrast the report calls "the result that inverts
expectations" — ZeroTTS 41/41, VieNeu 0/41 — **is an artefact of the harness, not
a property of the engines.** Both are stochastic. One was seeded.

## 2. VieNeu streams, and the TTFA comparison rests on it not streaming

> _"VieNeu has no streaming API, which is itself one of the findings this
> benchmark reports."_

`Vieneu.infer_stream` exists, takes the same sampling parameters, and yields
chunks. Measured with `run_engine.measure_stream` — the same function, the same
underrun accounting applied to ZeroTTS — over all 41 conversational sentences:

| Arm                                           | first chunk p50 | underrun p50 | underrun max | starved | **gapless start p50** |
| --------------------------------------------- | --------------: | -----------: | -----------: | ------: | --------------------: |
| VieNeu / Mai Anh                              |          269 ms |      −105 ms |       +38 ms |    4/41 |            **269 ms** |
| VieNeu / Thanh Bình                           |          318 ms |       −45 ms |      +477 ms |   17/41 |            **357 ms** |
| ZeroTTS _(report)_                            |      138–140 ms | +766…+798 ms |            — |    ~all |        **910–938 ms** |
| VieNeu clause-split _(the report's baseline)_ |               — |            — |            — |       — |           842–1256 ms |

ZeroTTS reaches the first sample sooner and then runs dry for three quarters of a
second. VieNeu reaches a _gapless_ start in 269–357 ms, roughly **three times
faster than ZeroTTS**, and three times faster than the clause-split figure the
report uses to represent it.

The report concluded TTFA "does not separate". Measured stream against stream, it
separates — the other way.

**Streaming costs no intelligibility.** Paired against whole-sentence synthesis in
one process at a fixed seed, with a same-path control:

| Voice      |  whole | stream |    diff |               95% CI | control |
| ---------- | -----: | -----: | ------: | -------------------: | ------: |
| Mai Anh    | 29.16% | 22.18% | −6.98pp | [−22.10, +5.73] ties | +0.00pp |
| Thanh Bình | 14.99% | 15.61% | +0.62pp |  [−2.85, +4.88] ties | −0.21pp |

Neither separates. Streaming is free for this engine.

## What this does to the verdict

Re-scoring the dimensions with both engines measured on equal terms:

| Dimension                       | Before              | After                               |
| ------------------------------- | ------------------- | ----------------------------------- |
| Intelligibility                 | ZeroTTS, clearly    | ZeroTTS, but confounded (see below) |
| Synthesis speed                 | VieNeu              | VieNeu, unchanged                   |
| **Time to first gapless audio** | tie                 | **VieNeu, ~3× faster**              |
| **Run-to-run reliability**      | "neither, both bad" | **tie — both pin under a seed**     |
| Load time, peak RAM             | VieNeu              | VieNeu, unchanged                   |
| Naturalness                     | unmeasured          | unmeasured                          |

ZeroTTS's case rested on three legs: better intelligibility, a headline TTFA
advantage, and reproducibility the incumbent appeared to lack. The second was
measured against the wrong baseline and reverses. The third was a harness
asymmetry and disappears.

The first leg still stands but carries two known discounts already on file: the
voice-selection confound (ZeroTTS's voices chosen for their "rõ ràng" labels,
VieNeu's by listening for naturalness) and the clause-split penalty measured in
`benchmark-260914-1629`, which costs `baotrang` 2.5–4.1pp on the path that ships.

## Recommendation

**Keep VieNeu.** The swap case has largely collapsed, and not because ZeroTTS got
worse — because two of the three arguments for it were measurement errors.

The MOS panel is no longer the thing that decides the swap. It is still worth
running, but as a quality baseline for the incumbent rather than as the gate on a
change that the rest of the evidence no longer supports.

**What to change in the product, independent of the swap:** seed the VieNeu call
and consider `infer_stream` in place of clause splitting. The app currently
splits text in front of a non-streaming API that turns out to stream. Whether
that is worth doing depends on how `infer_stream` interacts with the existing
clause pipeline, which is not measured here.

## What this does not establish

- **The intelligibility comparison is untouched by these findings.** ZeroTTS is
  still ahead on median WER. Nothing here reverses that, and the voice confound
  remains unmeasured in both directions.
- **The streaming measurement warmed up with `infer`, not `infer_stream`**, so
  the first streamed call is cold — the same flaw the audit flagged in the
  ZeroTTS streaming numbers. It affects one observation of 41.
- **Thanh Bình starves on 17 of 41 streams**, worst case +477 ms. VieNeu's
  streaming is not underrun-free, only far less starved than ZeroTTS's.
- **Seeded VieNeu was not re-benchmarked.** Every VieNeu number in the main
  report is still an unseeded draw. Pinning changes reproducibility, not
  necessarily level, and the seed sweep already sampled that distribution.
- **`infer_stream` output quality was checked by ASR, not by ear.**

## Unresolved questions

- Should `engines/vieneu_vi.py` seed and declare `supports_streaming = True`, and
  should the main run be redone on that footing? It would make the two arms
  symmetric for the first time, but it invalidates every VieNeu number on file.
- Does the app gain anything from `infer_stream` over its current clause
  splitter, given the splitter exists precisely to work around the streaming API
  the engine turns out to have?
- ~~Was the streaming API present in the pinned version, or added since?~~
  **Answered: present.** `pyproject.toml` pins `vieneu==3.3.0`, the main run's
  header records `"package_version": "3.3.0"`, and that is the version tested
  here. Both the sampler and `infer_stream` were available the whole time. This
  is a harness bug, not version drift.
- The seed sweep measured VieNeu as "bare repeats, because it has no seed knob".
  With a seed knob it should be measured by seed, like ZeroTTS. Does its spread
  look different when sampled that way?
