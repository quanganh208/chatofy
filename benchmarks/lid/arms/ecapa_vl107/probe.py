"""Accuracy-only probe: SpeechBrain ECAPA-TDNN VoxLingua107, as `lidbench`.

    sudo -u lidbench -H sh -c 'cd arms/ecapa_vl107 && ~/.local/bin/uv run --frozen python probe.py \\
        --manifest ../../results/<tag>/manifest.jsonl --ids <ids.txt> --out ../../results/<probe-tag>'

AmberNet cannot ship (NGC Terms of Use forbid offering it as a service), and
it was the voter that fixed short vi. ECAPA VoxLingua107 is trained on the
same 107-language YouTube corpus and is Apache-2.0, so it is the licence-clean
candidate for the same job. Its checkpoints are torch pickles and its
hyperparams.yaml names classes to instantiate: like AmberNet's NeMo
reference, it runs only as the isolated `lidbench` user (README, Isolation).

Pinned to `speechbrain/lang-id-voxlingua107-ecapa@REVISION`. Whole turns only,
no prefixes: this asks "does it know short turns", before any ONNX export.
Its 107-way posterior is masked to vi/en/zh (`lid_bench.arm_io.restrict`),
what the sidecar would do with a declared candidate set.

Writes `<out>/ecapa_vl107.scores.jsonl` in the arm format (the full set only,
so `score.py`'s candidate masking applies) and a meta marking it a ceiling
probe, never loaded as a gate arm. Latency is the torch CPU forward pass.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import arm_io  # noqa: E402
from lid_bench.audio import read_wav  # noqa: E402
from lid_bench.manifest import load  # noqa: E402

SOURCE = "speechbrain/lang-id-voxlingua107-ecapa"
REVISION = "0253049ae131d6a4be1c4f0d8b0ff483a0f8c8e9"
ARM = "ecapa_vl107"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ids", type=Path)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()

    import torch
    from huggingface_hub import snapshot_download
    from speechbrain.inference.classifiers import EncoderClassifier

    torch.set_num_threads(args.threads)
    local = snapshot_download(SOURCE, revision=REVISION)
    model = EncoderClassifier.from_hparams(source=local, savedir=str(HERE / "pretrained"), run_opts={"device": "cpu"})
    # Labels read "vi: Vietnamese"; the code before the colon is the language.
    labels = [model.hparams.label_encoder.decode_ndim(i).split(":")[0] for i in range(107)]

    turns = load(args.manifest)
    if args.ids:
        wanted = set(args.ids.read_text().split())
        turns = [t for t in turns if t.id in wanted]
    args.out.mkdir(parents=True, exist_ok=True)
    latencies = []
    with (args.out / f"{ARM}.scores.jsonl").open("w") as fh:
        for i, turn in enumerate(turns):
            samples = read_wav(BENCH_ROOT / turn.audio)
            start = time.perf_counter()
            with torch.no_grad():
                log_probs = model.classify_batch(torch.from_numpy(samples)[None])[0][0].numpy()
            latency = (time.perf_counter() - start) * 1000
            latencies.append(latency)
            probs = np.exp(log_probs - log_probs.max())
            probs = dict(zip(labels, (probs / probs.sum()).tolist()))
            fh.write(json.dumps({"id": turn.id, "prefix_ms": None, "speech_ms": turn.speech_ms,
                                 "probs": {"en+vi+zh": arm_io.restrict(probs)},
                                 "top": max(probs, key=probs.get), "latency_ms": round(latency, 2)}) + "\n")
            if i % 200 == 0:
                print(f"{i}/{len(turns)}", flush=True)
    meta = {"arm": ARM, "kind": "lid-model", "runtime": f"torch-{torch.__version__}", "ceiling_probe": True,
            "needs_gpu": False, "needs_torch": True, "new_model": True,
            "latency_p95_ms": round(float(np.percentile(latencies, 95)), 1) if latencies else None,
            "notes": [f"{SOURCE}@{REVISION}, Apache-2.0; whole turns only, torch CPU, {args.threads} threads"]}
    (args.out / f"{ARM}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {len(turns)} rows; p95 {meta['latency_p95_ms']} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
