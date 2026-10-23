"""Arm 3 -- facebook/mms-lid-126 (wav2vec2, 1B params): ACCURACY-ONLY.

126-language classifier from Meta's MMS. It is measured because it is the
strongest open LID model of its kind, not because it can ship: it runs on
torch + transformers, there is no ONNX path through the sidecar's
onnxruntime, and at 1B parameters it wants a GPU. So `runtime: transformers`
keeps it ineligible, and if it is the only arm that passes the gate says G5
(stop and ask) rather than G1. Run it on a rented GPU box, as `lidbench` or
equivalent; on CPU it still runs, slowly, and its latency is then meaningless.

CC BY-NC 4.0 -- fine for a non-commercial thesis (see README).

    uv run --frozen python arm.py --manifest M --out DIR --prefixes 600,...
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import arm_io, pinned  # noqa: E402

PINS = json.loads((HERE / "pins.json").read_text())
#: MMS labels are ISO 639-3.
CODES = {"vie": "vi", "eng": "en", "cmn": "zh"}


class MmsLid:
    def __init__(self, snapshot: Path) -> None:
        import torch
        from transformers import AutoFeatureExtractor, Wav2Vec2ForSequenceClassification

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.extractor = AutoFeatureExtractor.from_pretrained(snapshot)
        self.model = Wav2Vec2ForSequenceClassification.from_pretrained(snapshot, use_safetensors=True)
        self.model.eval().to(self.device)
        self.index = {CODES[label]: int(i) for i, label in self.model.config.id2label.items() if label in CODES}

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        inputs = self.extractor(samples, sampling_rate=16000, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            probs = self.model(**inputs).logits.softmax(-1)[0].cpu().numpy()
        return {lang: float(probs[i]) for lang, i in self.index.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefixes", default="")
    args = parser.parse_args()
    baseline = arm_io.rss_mib()
    model = MmsLid(pinned.fetch(PINS["model"]))
    arm_io.run("mms_lid", model, args.manifest, args.out, [int(p) for p in args.prefixes.split(",") if p], {
        "kind": "lid-model", "runtime": "transformers", "parity_passed": None,
        "needs_gpu": True, "needs_torch": True, "new_model": True,
        "notes": [f"device {model.device}; accuracy-only, no ONNX path through the sidecar runtime"],
    }, baseline)
    return 0


if __name__ == "__main__":
    sys.exit(main())
