"""Prove, with exit codes, every assumption the measurement phases depend on.

This is a committed script rather than a manual check because three of the
things it establishes are load-bearing for how phase 3 and phase 5 are written,
and "someone looked at it once" is not a record:

1. **Does ZeroTTS's first chunk arrive before the full forward pass?** If it does
   not, the vendor's 70 ms time-to-first-audio claim is unreproducible by
   construction, and the TTFA arm measures something other than what the verdict
   would weigh.
2. **Do the two decode paths produce the same audio?** `synthesize()` runs
   `decode_full.onnx`; `synthesize_stream()` runs the ring-buffered KV-cache
   `decode_step.onnx`. Phase 3 writes WAVs from the first and times the second,
   so if they differ, the WER and the TTFA describe different waveforms and the
   report has to say so.
3. **Is a seeded run reproducible?** ZeroTTS samples from the global RNG on every
   frame. If seeding does not pin the waveform, no single run means anything.

Exits non-zero on any failure. Prints a summary block that phase 1 copies into
README.md.
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_vi_bench.engines.vieneu_vi import VieNeuVi  # noqa: E402
from tts_vi_bench.engines.zerotts_vi import ZeroTtsVi  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "results" / "smoke"
TEXT = "Xin chào, cái này giá bao nhiêu?"
LONG_TEXT = (
    "Tôi đến đây lần đầu, nên anh gợi ý giúp tôi vài món ăn "
    "đặc trưng của vùng này được không?"
)

findings: dict[str, str] = {}
failures: list[str] = []


def check(name: str, ok: bool, detail: str) -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}", flush=True)
    findings[name] = detail
    if not ok:
        failures.append(name)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # --- both engines load and write playable audio, on both voices ----------
    for engine_cls in (VieNeuVi, ZeroTtsVi):
        engine = engine_cls()
        engine.load()
        for gender, voice in engine.VOICES.items():
            samples, sr = engine.synthesize(TEXT, voice)
            path = OUT_DIR / f"{engine.engine_id}-{gender}.wav"
            sf.write(path, samples, sr, subtype="PCM_16")
            ok = samples.size > 0 and np.isfinite(samples).all() and np.ptp(samples) > 0.01
            check(
                f"{engine.engine_id}/{gender} synthesis",
                ok,
                f"{samples.size} samples @ {sr} Hz, peak {np.abs(samples).max():.3f} -> {path.name}",
            )
        if engine_cls is VieNeuVi:
            check("vieneu sample_rate", sr > 0, f"{sr} Hz")

    # --- ZeroTTS streaming: chunk count, and whether first audio precedes full
    z = ZeroTtsVi()
    z.load()
    voice = z.VOICES["female"]

    import time

    t0 = time.perf_counter()
    chunks = []
    first_chunk_s = None
    for chunk in z.synthesize_stream(LONG_TEXT, voice):
        if first_chunk_s is None and chunk.size:
            first_chunk_s = time.perf_counter() - t0
        chunks.append(chunk)
    stream_total_s = time.perf_counter() - t0

    check("zerotts streaming chunk count", len(chunks) > 1, f"{len(chunks)} chunks")

    t0 = time.perf_counter()
    whole, sr = z.synthesize(LONG_TEXT, voice)
    whole_s = time.perf_counter() - t0

    precedes = first_chunk_s is not None and first_chunk_s < whole_s
    check(
        "first chunk precedes full forward pass",
        precedes,
        f"first chunk {first_chunk_s*1000:.0f} ms vs whole-sentence {whole_s*1000:.0f} ms "
        f"(stream total {stream_total_s*1000:.0f} ms)",
    )

    # --- do the two decoders agree? ---------------------------------------
    # Not a curiosity: phase 3 writes WAVs from synthesize() and times
    # synthesize_stream(), which run decode_full.onnx and the ring-buffered
    # decode_step.onnx respectively. If they diverge, the WER and the TTFA
    # describe different audio and the report must say so. Checked over several
    # sentences and both voices, and ASSERTED rather than merely printed — a
    # check that cannot fail is not evidence.
    streamed = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    sf.write(OUT_DIR / "zerotts-streamed.wav", streamed, sr, subtype="PCM_16")
    sf.write(OUT_DIR / "zerotts-whole.wav", whole, sr, subtype="PCM_16")

    AUDIBLE = 1e-3
    worst = 0.0
    cases = 0
    for v in z.VOICES.values():
        for text in (TEXT, LONG_TEXT):
            w, _ = z.synthesize(text, v)
            st = np.concatenate(list(z.synthesize_stream(text, v)))
            cases += 1
            if st.size != w.size:
                worst = float("inf")
                break
            worst = max(worst, float(np.abs(st - w).max()))
    check(
        "decoders equivalent",
        worst < AUDIBLE,
        f"peak delta {worst:.2e} over {cases} sentence/voice pairs "
        f"(threshold {AUDIBLE:.0e}; equal length in every case)"
        if worst != float("inf") else
        "DIVERGE — streamed and whole-sentence output differ in length",
    )

    # --- is a seeded run reproducible? --------------------------------------
    a, _ = z.synthesize(TEXT, voice)
    b, _ = z.synthesize(TEXT, voice)
    check(
        "seeded run reproducible",
        a.shape == b.shape and np.array_equal(a, b),
        f"two seeded runs {'match' if a.shape == b.shape and np.array_equal(a, b) else 'DIVERGE'} "
        f"({a.size} vs {b.size} samples)",
    )

    print("\n=== summary for README.md ===")
    for k, v in findings.items():
        print(f"- {k}: {v}")

    if failures:
        print(f"\nFAILED: {failures}", file=sys.stderr)
        return 1
    print("\nAll smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
