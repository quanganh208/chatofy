"""Fetch every model this harness measures, so no download lands inside a clock.

Idempotent. Run once before the first benchmark; later runs are no-ops.

**Both engines are pre-warmed here, not only ZeroTTS.** VieNeu fetches its
weights during construction, so if it were left out, its `load_s` would contain
a model download on a cold cache — and, worse, a `huggingface_hub` revision
check even on a warm one, while ZeroTTS loaded from an already-populated cache.
That asymmetry is the dangerous case precisely because it looks like a clean
warm-start measurement rather than a broken one. Constructing VieNeu once here
and discarding it makes the two arms start from the same state. Every graph the
harness measures is constructed, for the same reason one arm deeper.

Measured runs additionally set `HF_HUB_OFFLINE=1`, which turns a missing model
into a loud failure instead of a slow success.
"""

import sys


def fetch_zerotts() -> None:
    """Resolve ZeroTTS weights at the revision the package pins."""
    from zerotts import ZeroTTS, hub

    print(f"[zerotts] repo {hub.DEFAULT_REPO_ID} @ {hub.DEFAULT_REVISION}", flush=True)
    # Constructing is what populates the cache; warmup=False keeps this script
    # from doing work the benchmark will redo anyway.
    tts = ZeroTTS.from_pretrained(hub.DEFAULT_REPO_ID, warmup=False)
    print(f"[zerotts] ready, sample_rate={tts.sample_rate}", flush=True)


def fetch_vieneu() -> None:
    """Construct VieNeu on every graph the harness measures, so all are cached.

    Both precisions, not only the one the sidecar ships: fp32 and int8 are
    separate subfolders of the same model repo (`onnx_update` and `onnx_int8`),
    and the cache materializes only what was actually requested. Warming fp32
    alone would leave the int8 arm's first `load_s` holding a 165 MB download
    inside a timed section — the same asymmetry described above, one arm deep.
    """
    from vieneu import Vieneu

    for precision in ("fp32", "int8"):
        print(f"[vieneu] constructing v3turbo/{precision} to populate the cache", flush=True)
        engine = Vieneu(mode="v3turbo", precision=precision, threads=1)
        print(f"[vieneu] {precision} ready, sample_rate={engine.sample_rate}", flush=True)


def fetch_asr_judges() -> None:
    """Phase 4's round-trip judges. Imported lazily — absent until phase 4."""
    try:
        from tts_vi_bench.asr_judges import download_judges
    except ImportError:
        print("[asr] judges not installed yet (phase 4); skipping", flush=True)
        return
    download_judges()


def main() -> int:
    fetch_zerotts()
    fetch_vieneu()
    fetch_asr_judges()
    print("[done] all models cached", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
