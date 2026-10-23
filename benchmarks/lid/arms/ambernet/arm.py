"""Arm 1 -- NVIDIA AmberNet (VoxLingua107 LID), scored through ONNX.

Runtime: `models/ambernet/ambernet.onnx` on the sidecar's onnxruntime 1.27.0
with the numpy frontend (`frontend.py`) -- the shape the sidecar would run.
Reference: the NeMo model itself, used only for the parity check on 100
clips; its accuracy is never reported as the arm's.

Run `export_onnx.py` first, as `lidbench`:
    uv run --frozen python arm.py --manifest M --out DIR --prefixes 600,...
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
sys.path.insert(0, str(BENCH_ROOT))
sys.path.insert(0, str(HERE))

from frontend import Frontend  # noqa: E402
from lid_bench import arm_io, parity  # noqa: E402
from lid_bench.audio import read_wav  # noqa: E402
from lid_bench.manifest import load  # noqa: E402

MODEL_DIR = BENCH_ROOT / "models" / "ambernet"


def softmax(logits: np.ndarray, labels: list[str]) -> dict[str, float]:
    z = np.exp(logits - logits.max())
    return dict(zip(labels, (z / z.sum()).tolist()))


class OnnxAmberNet:
    def __init__(self, threads: int) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(MODEL_DIR / "ambernet.onnx"), options)
        self.inputs = [i.name for i in self.session.get_inputs()]
        self.frontend = Frontend(MODEL_DIR / "frontend.npz")
        self.labels = json.loads((MODEL_DIR / "labels.json").read_text())

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        features, valid = self.frontend(samples)
        feeds = {self.inputs[0]: features[None], self.inputs[1]: np.array([valid], dtype=np.int64)}
        logits = self.session.run(None, feeds)[0][0]
        return softmax(logits, self.labels)


class NemoAmberNet:
    def __init__(self) -> None:
        import torch
        from nemo.collections.asr.models import EncDecSpeakerLabelModel

        self.torch = torch
        self.model = EncDecSpeakerLabelModel.from_pretrained("langid_ambernet", map_location="cpu").eval()
        self.labels = json.loads((MODEL_DIR / "labels.json").read_text())

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        signal = self.torch.from_numpy(samples)[None]
        with self.torch.no_grad():
            logits, _ = self.model.forward(input_signal=signal, input_signal_length=self.torch.tensor([len(samples)]))
        return softmax(logits[0].numpy(), self.labels)


def parity_check(manifest: Path, out: Path, threads: int) -> None:
    """NeMo reference vs ONNX runtime on the parity clips; its own process."""
    runtime = OnnxAmberNet(threads)
    reference = NemoAmberNet()
    clips = [t for t in load(manifest) if not t.noise][: parity.PARITY_CLIPS]
    ref = {t.id: arm_io.restrict(reference(read_wav(BENCH_ROOT / t.audio))) for t in clips}
    run = {t.id: arm_io.restrict(runtime(read_wav(BENCH_ROOT / t.audio))) for t in clips}
    arm_io.write_parity("ambernet", out, parity.compare(ref, run).as_dict())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefixes", default="")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--parity-only", action="store_true")
    args = parser.parse_args()
    if not (MODEL_DIR / "ambernet.onnx").exists():
        print("no models/ambernet/ambernet.onnx: run export_onnx.py first", file=sys.stderr)
        return 1
    if args.parity_only:
        parity_check(args.manifest, args.out, args.threads)
        return 0
    # Parity in a child: NeMo + torch would otherwise be billed to the
    # runtime's peak RSS, which is the number the sidecar's limit is set from.
    subprocess.run([sys.executable, __file__, "--manifest", str(args.manifest), "--out", str(args.out),
                    "--threads", str(args.threads), "--parity-only"], check=True)
    passed = json.loads((args.out / "ambernet.parity.json").read_text())["passed"]
    baseline = arm_io.rss_mib()
    runtime = OnnxAmberNet(args.threads)
    provenance = json.loads((MODEL_DIR / "provenance.json").read_text())
    arm_io.run("ambernet", runtime, args.manifest, args.out, [int(p) for p in args.prefixes.split(",") if p], {
        "kind": "lid-model", "runtime": "onnxruntime-1.27.0", "parity_passed": passed,
        "needs_gpu": False, "needs_torch": False, "new_model": True,
        "notes": [f"licence: {provenance['licence']}", f"redistribution_ok: {provenance['redistribution_ok']}"],
    }, baseline)
    return 0


if __name__ == "__main__":
    sys.exit(main())
