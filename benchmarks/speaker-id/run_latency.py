"""Bench 3 — embedding latency, idle and under CPU contention.

Tests the design's load-bearing latency claim: that speaker embedding can hide
inside the translation window rather than adding to a turn.

The claim rests on two things. First, translation is a *network* call to Gemini
(measured p50 723ms), so the box is idle during it. Second, the embedding is
dispatched separately rather than piggybacked on `/transcribe` — piggybacking
would put it before translation can start, making it serial.

The second is a design decision already recorded. The first is what this
measures, and it is where the claim can quietly fail: **the CPU is only idle for
THIS session.** With concurrent users another session's STT is decoding, and both
recognizers ask ONNX Runtime for threads on the same box. So every cell is
measured twice — alone, and with a real STT recognizer decoding continuously.

Deliberately depends on numpy and sherpa-onnx only, so the identical script runs
both in this bench's venv and inside the production sidecar image, where the
ONNX Runtime build and thread environment are production's own.

Run (host):
    uv run python run_latency.py --out results/latency-host.csv

Run (inside the production image — see README):
    docker run --rm \\
      -e LOCAL_STT_THREADS=4 -e OMP_NUM_THREADS=4 -e MKL_NUM_THREADS=4 \\
      -v "$PWD:/bench" -v "$PWD/../../services/local-stt/models:/stt-models:ro" \\
      chatofy_prod-local-stt \\
      /app/.venv/bin/python /bench/run_latency.py \\
        --models-dir /bench/models --stt-models-dir /stt-models \\
        --out /bench/results/latency-container.csv

The OMP/MKL variables matter: the sidecar sets them at import
(`services/local-stt/app.py:16-18`) BEFORE anything pulls in ONNX Runtime, which
sizes its pool at import time. Running this script with `python` directly does
not go through `app.py`, so they must be passed in or the run measures a
different thread environment than production's. The script warns when they are
unset rather than letting the difference pass unnoticed.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import statistics
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
SAMPLE_RATE = 16_000

#: Measured p50 of one translation round trip (see speech-gate.ts). Embedding
#: has to fit inside this to cost nothing at the median.
TRANSLATION_WINDOW_MS = 723.0

#: Utterance lengths to time, in seconds. 1-3s is the realistic turn range; 5s
#: is included because cost should scale with input and a flat curve would mean
#: something other than the audio dominates.
DURATIONS_S = (1.0, 2.0, 3.0, 5.0)

#: Thread counts for the EXTRACTOR.
#:
#: The design specifies 1-2 to avoid oversubscribing a box whose STT recognizer
#: already holds threads. 8 is measured to show what that choice costs or saves,
#: rather than asserting it.
EXTRACTOR_THREADS = (1, 2, 8)

#: How many concurrent STT decodes the box can actually run.
#:
#: Not a session count. `services/local-stt/engines/registry.py:15-16` registers
#: exactly two engines (vi, en), and `engines/base.py:63,88` gives each its own
#: lock held across the whole decode. So however many sessions arrive, at most
#: TWO decodes run at once — which makes the concurrency ceiling a one-parameter
#: question rather than an open one.
MAX_CONCURRENT_DECODES = 2

#: STT thread counts for the contended condition — BOTH real deployments.
#:
#: Production sets 4 (`docker-compose.prod.yml:209`, `PROD_LOCAL_STT_THREADS`),
#: dev sets 8 (`docker-compose.yml:66`). The plan assumed 8 everywhere; on an
#: 8-physical-core host that difference decides whether the extractor is
#: competing for the whole machine or half of it, so both are measured.
STT_THREADS = (4, 8)

#: Timed calls per cell, warm-up excluded.
#:
#: 50 rather than 12. At 12 the "p95" was the second-largest sample — about the
#: 87th percentile, and BELOW a true p95 — so it understated the tail while
#: being labelled p95. Twelve was also not reproducible: the same
#: eres2netv2/contended-stt8/thr2/3s cell measured 333ms on the host and 522ms
#: in the container, a 57% spread, with contended cells diverging up to 116%
#: between runs. The full matrix costs about ten minutes at 50, which is nothing
#: against a gate decision.
REPS = 50
WARMUP = 3


@dataclass(frozen=True)
class Row:
    model: str
    condition: str
    stt_threads: int
    #: Concurrent STT recognizers during this cell. 0 when idle.
    stt_instances: int
    extractor_threads: int
    duration_s: float
    p50_ms: float
    p95_ms: float
    min_ms: float
    max_ms: float
    reps: int
    fits_window: bool
    # Environment travels WITH the row: the phase file says the number is
    # meaningless without it, and a CSV that outlives its sibling log would
    # otherwise carry timings nobody can attribute to a machine.
    host: str
    cpus: int
    omp_threads: str


def speech_like(duration_s: float, *, seed: int = 7) -> np.ndarray:
    """Noise at speech-ish amplitude.

    Content is irrelevant to timing — these nets do a fixed amount of work per
    frame — but silence is avoided in case any implementation short-circuits it.
    """
    rng = np.random.default_rng(seed)
    return rng.uniform(-0.3, 0.3, int(SAMPLE_RATE * duration_s)).astype(np.float32)


class SttLoad:
    """A real STT recognizer decoding in a loop, as the contending workload.

    A synthetic busy-loop would contend for cores but not for ONNX Runtime's
    thread pools or memory bandwidth, which is the part that actually matters
    here. So this runs the same recognizer the sidecar runs
    (`services/local-stt/engines/moonshine_en.py`), built the same way.
    """

    def __init__(self, models_dir: Path, num_threads: int, instances: int = 1) -> None:
        import sherpa_onnx

        if instances < 1:
            raise ValueError("instances must be >= 1")

        model_dir = models_dir / "sherpa-onnx-moonshine-base-en-int8"
        missing = [
            name
            for name in (
                "preprocess.onnx",
                "encode.int8.onnx",
                "uncached_decode.int8.onnx",
                "cached_decode.int8.onnx",
                "tokens.txt",
            )
            if not (model_dir / name).exists()
        ]
        if missing:
            raise FileNotFoundError(f"{model_dir}: missing {missing}")

        # One recognizer per instance: production's two engines are separate
        # objects with separate locks, so sharing one recognizer here would
        # serialise the load and model less contention than actually exists.
        self.instances = instances
        self._recognizers = [
            sherpa_onnx.OfflineRecognizer.from_moonshine(
                preprocessor=str(model_dir / "preprocess.onnx"),
                encoder=str(model_dir / "encode.int8.onnx"),
                uncached_decoder=str(model_dir / "uncached_decode.int8.onnx"),
                cached_decoder=str(model_dir / "cached_decode.int8.onnx"),
                tokens=str(model_dir / "tokens.txt"),
                num_threads=num_threads,
            )
            for _ in range(instances)
        ]
        self._audio = speech_like(3.0, seed=11)
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        # One counter per loader: exactly one writer each, so no lock is needed
        # and none is claimed. A single shared counter WOULD race as soon as
        # there is more than one loader.
        self._decodes = [0] * instances

    @property
    def decodes(self) -> int:
        return sum(self._decodes)

    def _run(self, index: int) -> None:
        recognizer = self._recognizers[index]
        while not self._stop.is_set():
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, self._audio)
            recognizer.decode_stream(stream)
            self._decodes[index] += 1

    def __enter__(self) -> SttLoad:
        for index in range(self.instances):
            thread = threading.Thread(target=self._run, args=(index,), daemon=True)
            thread.start()
            self._threads.append(thread)
        # Let the load actually start before timing against it; otherwise the
        # first measured cells run against a still-warming recognizer and read
        # as "contention is free".
        time.sleep(2.0)
        if any(count == 0 for count in self._decodes):
            # Stop what did start, so a failure here cannot leave loaders
            # running against whatever the caller does next.
            self.__exit__()
            raise RuntimeError(
                f"only {sum(1 for c in self._decodes if c)} of {self.instances} "
                "STT loaders produced a decode; contention is not real"
            )
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=30)
        self._threads.clear()


def time_embedding(extractor, audio: np.ndarray) -> list[float]:
    """Wall time per call in ms, warm-up discarded.

    The first call pays model warm-up and lazily-allocated arenas — orders of
    magnitude slower — so including it would inflate the median and hide the
    number this bench exists to produce.
    """
    samples: list[float] = []
    for index in range(WARMUP + REPS):
        start = time.perf_counter()
        stream = extractor.create_stream()
        stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=audio)
        stream.input_finished()
        extractor.compute(stream)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        if index >= WARMUP:
            samples.append(elapsed_ms)
    return samples


def percentile(values: list[float], fraction: float) -> float:
    """Nearest-rank percentile.

    Returns the smallest observed sample at or above the requested rank, so the
    answer is a value that actually occurred and never sits BELOW the percentile
    it claims. The naive `round(fraction * (n-1))` index does sit below it: at
    n=12 it returns the second-largest sample, roughly the 87th percentile,
    understating a tail while being labelled p95.
    """
    if not values:
        raise ValueError("percentile of an empty sequence")
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def discover_models(models_dir: Path) -> dict[str, Path]:
    """Every speaker-embedding model present, by short key.

    Read off disk rather than imported from `speaker_bench.embed`, because this
    script must also run inside the sidecar image where the bench package and
    its soundfile dependency are not installed.
    """
    known = {
        "eres2netv2": "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",
        "campplus": "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        "wespeaker_en": "wespeaker_en_voxceleb_CAM++.onnx",
    }
    found = {key: models_dir / name for key, name in known.items()}
    return {key: path for key, path in found.items() if path.exists()}


def build_extractor(path: Path, num_threads: int):
    import sherpa_onnx

    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(path), num_threads=num_threads, debug=False
    )
    if not config.validate():
        raise RuntimeError(f"invalid extractor config: {path}")
    return sherpa_onnx.SpeakerEmbeddingExtractor(config)


def environment() -> dict[str, object]:
    return {
        "host": "container" if Path("/.dockerenv").exists() else "host",
        "cpus": os.cpu_count() or 0,
        "omp_threads": os.environ.get("OMP_NUM_THREADS", "(unset)"),
    }


def measure(
    models: dict[str, Path], condition: str, stt_threads: int, stt_instances: int = 0
) -> list[Row]:
    rows: list[Row] = []
    env = environment()
    for model_key, model_path in models.items():
        for threads in EXTRACTOR_THREADS:
            extractor = build_extractor(model_path, threads)
            for duration in DURATIONS_S:
                audio = speech_like(duration)
                timings = time_embedding(extractor, audio)
                p50 = statistics.median(timings)
                rows.append(
                    Row(
                        model=model_key,
                        condition=condition,
                        stt_threads=stt_threads,
                        stt_instances=stt_instances,
                        extractor_threads=threads,
                        duration_s=duration,
                        p50_ms=p50,
                        p95_ms=percentile(timings, 0.95),
                        min_ms=min(timings),
                        max_ms=max(timings),
                        reps=len(timings),
                        fits_window=fits_window(percentile(timings, 0.95)),
                        **env,
                    )
                )
                print(
                    f"  {model_key:13s} thr={threads} {duration:.0f}s  "
                    f"p50={p50:7.1f}ms  p95={percentile(timings, 0.95):7.1f}ms",
                    flush=True,
                )
    return rows


def write_csv(path: Path, rows: list[Row]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(Row.__dataclass_fields__)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: getattr(row, field) for field in fields})


#: Extractor threads the gate actually judges.
#:
#: The design mandates 1-2 to avoid oversubscribing a box whose STT recognizer
#: already holds threads, and the measurements pick 2 out of that range. Judging
#: "any configuration" instead would pass a model that only fits at 8 threads —
#: a configuration this system will never run — which is a false clean.
GATED_THREADS = 2

#: Conditions the gate judges. `contended-stt8` is DEV parity
#: (`docker-compose.yml:66`); production runs 4 (`docker-compose.prod.yml:209`),
#: so stt8 is printed as context and does not decide the exit code.
GATED_CONDITIONS = ("idle", "contended-stt4")

def fits_window(p95_ms: float) -> bool:
    """Whether one cell's tail fits inside the translation window.

    A function rather than an inline comparison so it is reachable from a test.
    Hardcoding this to True previously survived every test in the suite, because
    the only path to it was a real measurement run.
    """
    return p95_ms < TRANSLATION_WINDOW_MS


def headroom(p95_ms: float) -> float:
    """Fraction of the window left unused. Negative when the cell exceeds it."""
    return (TRANSLATION_WINDOW_MS - p95_ms) / TRANSLATION_WINDOW_MS


def classify(p95_ms: float) -> str:
    """EXCEEDS / MARGINAL / FITS for a single cell.

    Also a function for reachability: hardcoding the label previously survived,
    because the test asserting "MARGINAL" matched the run-level summary line
    rather than the per-condition line it meant to check.
    """
    if not fits_window(p95_ms):
        return "EXCEEDS"
    if headroom(p95_ms) < MARGINAL_HEADROOM:
        return "MARGINAL"
    return "FITS"


#: Headroom below which a fit is reported as MARGINAL rather than clean.
#:
#: With REPS=12 a "p95" is the second-worst of twelve samples, and the contended
#: cells move run to run — the same eres2netv2 stt8 cell measured 333ms on the
#: host and 522ms in the container. A fit inside this margin is inside the noise,
#: so calling it clean would overstate what was measured.
MARGINAL_HEADROOM = 0.30


#: Duration the thread comparison is made at.
#:
#: Fixed, because comparing across durations AND thread counts at once answers
#: the wrong question: the minimum is then always the shortest input, and the
#: "best" thread count is whichever won on 1s — not a recommendation. 3s is the
#: long end of a realistic turn and the case where the choice actually bites.
RECOMMENDATION_DURATION_S = 3.0


def recommend_threads(rows: list[Row]) -> dict[tuple[str, str], tuple[int, float]]:
    """Best extractor thread count per (model, condition), at a FIXED duration.

    Returns {(model, condition): (threads, p95_ms)}. This is acceptance
    criterion 3, and it has to compare like with like: a comparison that ranges
    over durations as well as threads reports the fastest CELL, which is always
    the shortest input, and names its thread count as though it were a choice.
    """
    best: dict[tuple[str, str], tuple[int, float]] = {}
    for row in rows:
        if row.duration_s != RECOMMENDATION_DURATION_S:
            continue
        key = (row.model, row.condition)
        if key not in best or row.p95_ms < best[key][1]:
            best[key] = (row.extractor_threads, row.p95_ms)
    return best


def verdict(rows: list[Row]) -> int:
    """Print the per-model verdict. Returns an exit code.

    The exit code is decided ONLY by the recommended configuration under the
    production condition: extractor threads == GATED_THREADS, condition in
    GATED_CONDITIONS, realistic turn lengths. Everything else is printed as
    diagnostics — informative, but not something that can turn a fail into a
    pass or vice versa.
    """
    print(f"\n{'=' * 72}\nVERDICT — does embedding fit inside the {TRANSLATION_WINDOW_MS:.0f}ms "
          "translation window?\n" + "=" * 72)

    print(
        f"gated on: extractor threads={GATED_THREADS}, conditions={'/'.join(GATED_CONDITIONS)}, "
        "turns <=3s. Other rows are diagnostics."
    )

    models = sorted({row.model for row in rows})
    failures: list[str] = []
    marginals: list[str] = []

    for model in models:
        print(f"\n{model}")
        for condition in sorted({r.condition for r in rows}):
            subset = [
                r
                for r in rows
                if r.model == model and r.condition == condition and r.duration_s <= 3.0
            ]
            if not subset:
                # Possible if DURATIONS_S is ever changed to drop short turns.
                # Say so rather than crashing on min() of an empty sequence.
                print(f"  {condition:22s} no turns <=3s measured — cannot decide")
                continue

            gated = [r for r in subset if r.extractor_threads == GATED_THREADS]
            judged = condition in GATED_CONDITIONS and bool(gated)
            shown = gated or subset
            worst = max(shown, key=lambda r: r.p95_ms)
            label = classify(worst.p95_ms)
            margin = headroom(worst.p95_ms)

            role = "GATE " if judged else "diag "
            span = f"{min(r.p95_ms for r in shown):6.1f}-{worst.p95_ms:7.1f}ms"
            print(
                f"  {role}{condition:20s} p95 {span} "
                f"(thr={GATED_THREADS if gated else 'any'}, headroom {margin * 100:4.0f}%)  {label}"
            )

            if judged:
                if label == "EXCEEDS":
                    failures.append(f"{model}/{condition}")
                elif label == "MARGINAL":
                    marginals.append(f"{model}/{condition}")

    # Acceptance criterion 3. Printed per condition because the answer is not
    # the same everywhere: more threads win when the box is idle, fewer win when
    # something else is already holding it.
    print(f"\nRECOMMENDED extractor num_threads (compared at {RECOMMENDATION_DURATION_S:.0f}s):")
    best = recommend_threads(rows)
    for (model, condition), (threads, p95) in sorted(best.items()):
        marker = "  <- production" if condition == "contended-stt4" else ""
        print(f"  {model:13s} {condition:20s} threads={threads}  p95 {p95:7.1f}ms{marker}")

    instances = sorted({r.stt_instances for r in rows if r.stt_instances})
    measured = ", ".join(str(i) for i in instances) or "none"
    if MAX_CONCURRENT_DECODES in instances:
        print(
            f"\nCONCURRENCY CEILING: measured up to {MAX_CONCURRENT_DECODES} concurrent STT "
            "decodes, which is the architectural maximum — `engines/registry.py` registers "
            "exactly two engines (vi, en) and each holds its own lock across a decode, so "
            "session count cannot push it higher."
        )
    else:
        print(
            f"\nCONCURRENCY CEILING NOT ESTABLISHED: measured at {measured} concurrent STT "
            f"decode(s); the architectural maximum is {MAX_CONCURRENT_DECODES} "
            "(two engines, one lock each). Re-run with --stt-instances "
            f"{MAX_CONCURRENT_DECODES} to close this."
        )

    if failures:
        print(f"\nFAIL — recommended configuration exceeds the window for: {', '.join(failures)}")
        return 1
    if marginals:
        print(
            f"\nPASS (MARGINAL) — fits with under {MARGINAL_HEADROOM * 100:.0f}% headroom for: "
            f"{', '.join(marginals)}. Inside run-to-run noise at REPS={REPS}; re-measure with more "
            "repetitions before relying on it."
        )
        return 0
    print("\nPASS — the recommended configuration fits the window at production contention.")
    return 0


#: Exit code for a run that completed but did not measure what the gate needs.
#:
#: Distinct from both 0 and the verdict's 1. Previously an incomplete run
#: printed "INCOMPLETE" to stderr and then returned the verdict — so an
#: idle-only artifact exited 0 and any wrapper read it as a pass.
EXIT_INCOMPLETE = 3


def main() -> int:
    # Declared up front because Python requires it before any use of the names,
    # and the argument defaults below read them. `time_embedding` and `verdict`
    # both read the module-level values, so overriding them here is what makes
    # --reps/--warmup take effect everywhere.
    global REPS, WARMUP

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, default=BENCH_ROOT / "models")
    parser.add_argument(
        "--stt-models-dir",
        type=Path,
        default=BENCH_ROOT.parent.parent / "services" / "local-stt" / "models",
        help="Where the sidecar's STT weights live; used for the contended condition.",
    )
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "latency.csv")
    parser.add_argument(
        "--reps", type=int, default=REPS, help=f"Timed calls per cell (default {REPS})."
    )
    parser.add_argument(
        "--warmup", type=int, default=WARMUP, help=f"Discarded calls per cell (default {WARMUP})."
    )
    parser.add_argument(
        "--stt-instances",
        type=int,
        default=1,
        help=(
            "Concurrent STT recognizers in the contended condition. The architectural "
            f"maximum is {MAX_CONCURRENT_DECODES} (two engines, one lock each); pass that "
            "to establish the concurrency ceiling."
        ),
    )
    parser.add_argument(
        "--skip-contended",
        action="store_true",
        help=f"Idle only. Faster, but INCOMPLETE for the gate — exits {EXIT_INCOMPLETE}.",
    )
    args = parser.parse_args()
    REPS, WARMUP = args.reps, args.warmup

    if args.stt_instances > MAX_CONCURRENT_DECODES:
        print(
            f"  NOTE: --stt-instances {args.stt_instances} exceeds the architectural maximum "
            f"of {MAX_CONCURRENT_DECODES}; measuring load production cannot produce.",
            file=sys.stderr,
        )

    models = discover_models(args.models_dir)
    if not models:
        print(
            f"no speaker models under {args.models_dir}; run scripts/download_models.py",
            file=sys.stderr,
        )
        return 2

    omp = os.environ.get("OMP_NUM_THREADS")
    print(f"host cpus        : {os.cpu_count()}  ({environment()['host']})")
    print(f"OMP_NUM_THREADS  : {omp or '(unset)'}")
    print(f"MKL_NUM_THREADS  : {os.environ.get('MKL_NUM_THREADS', '(unset)')}")
    print(f"LOCAL_STT_THREADS: {os.environ.get('LOCAL_STT_THREADS', '(unset)')}")
    print(f"models           : {', '.join(sorted(models))}")
    print(f"reps={REPS} warmup={WARMUP} (discarded)  stt-instances={args.stt_instances}\n")
    if omp is None:
        # Not fatal — sherpa-onnx passes num_threads straight to ORT's intra-op
        # pool, so the per-call thread count is still what it says. But the
        # sidecar sets these at import (app.py:16-18) and ORT sizes its pool
        # then, so an unset value is a real difference from production and must
        # not be discovered later by whoever reads the CSV.
        print(
            "  WARNING: OMP/MKL thread vars unset. Production sets them at import via "
            "app.py. Pass -e OMP_NUM_THREADS=<LOCAL_STT_THREADS> to match.",
            file=sys.stderr,
        )

    rows: list[Row] = []
    incomplete: list[str] = []

    try:
        print("condition: idle")
        rows += measure(models, "idle", 0, 0)

        if args.skip_contended:
            incomplete.append("--skip-contended was passed")
        else:
            for stt_threads in STT_THREADS:
                label = f"contended-stt{stt_threads}"
                print(
                    f"\ncondition: {label}  ({args.stt_instances} real Moonshine "
                    "recognizer(s) decoding continuously)"
                )
                try:
                    with SttLoad(args.stt_models_dir, stt_threads, args.stt_instances) as load:
                        rows += measure(models, label, stt_threads, args.stt_instances)
                        print(f"  (STT completed {load.decodes} decodes during this block)")
                except (FileNotFoundError, RuntimeError, ImportError) as error:
                    # Loud, and the run continues so the idle rows are not lost —
                    # but the artifact must not then look complete. Catching
                    # only FileNotFoundError previously let an ImportError or a
                    # dead-loader RuntimeError escape and discard everything.
                    print(f"  SKIPPED {label}: {error}", file=sys.stderr)
                    incomplete.append(f"{label}: {error}")
    finally:
        # In a finally so a failure anywhere above still lands whatever was
        # measured. Losing an hour of idle rows to a contended-block crash is
        # pure waste, and re-running is not free.
        if rows:
            write_csv(args.out, rows)
            print(f"\nwrote {len(rows)} rows -> {args.out}")

    if not rows:
        print("no rows measured", file=sys.stderr)
        return EXIT_INCOMPLETE

    code = verdict(rows)

    if incomplete:
        print(
            "\nINCOMPLETE — this run does not satisfy Phase 5:\n  - "
            + "\n  - ".join(incomplete),
            file=sys.stderr,
        )
        # Deliberately overrides a passing verdict: a gate that never ran the
        # contended condition has not been passed, whatever the idle rows say.
        return EXIT_INCOMPLETE

    return code


if __name__ == "__main__":
    sys.exit(main())
