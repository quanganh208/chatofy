"""Arm 2 -- Whisper's language probabilities at the first decoder step.

Whisper predicts a language token right after <|startoftranscript|>; the
softmax over the language tokens at that step IS a language classifier. The
three tokens <|vi|>, <|en|>, <|zh|> are read out and renormalised.

Scored through the runtime that could ship: ONNX encoder + decoder
(onnx-community exports, pinned in pins.json) on the sidecar's onnxruntime
1.27.0, with transformers' numpy feature extractor. faster-whisper
(CTranslate2) is only the parity REFERENCE: it is how Whisper LID is usually
run, and agreeing with it is what licenses calling the ONNX path "Whisper".

Four sizes; each is its own arm (`whisper_probs_<size>`) because each is its
own latency/RSS trade. `<size>_ctx` is the same weights with the encoder cut to
the turn's length (window.py) instead of a 30 s window; `<size>_ctx<N>` cuts
it to the turn but never below N seconds.

Run as the `lidbench` user only (run_bakeoff.py enforces it):
    uv run --frozen python arm.py --manifest M --out DIR --prefixes 600,... [--sizes tiny,base]
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

from lid_bench import arm_io, parity, pinned  # noqa: E402
from lid_bench.audio import read_wav  # noqa: E402
from lid_bench.manifest import load  # noqa: E402

PINS = json.loads((HERE / "pins.json").read_text())
SOT = "<|startoftranscript|>"
LANG_TOKENS = {"vi": "<|vi|>", "en": "<|en|>", "zh": "<|zh|>"}
#: `base_ctx` encodes the turn only; `base_ctx5` encodes at least 5 s of it
#: (the turn plus Whisper's own zero padding). Whisper was trained on 30 s
#: windows and a 1 s one loses accuracy on short turns; a floor buys it back
#: at the cost of encoding the padding.
CTX = "_ctx"
#: A windowed turn is padded up to a whole number of these: fewer distinct
#: encoder shapes, and never a window shorter than one step.
WINDOW_STEP_S = 1
RATE = 16000


def base_size(size: str) -> str:
    return size.split(CTX)[0]


def min_window_s(size: str) -> int | None:
    """The size's window floor in seconds, or None for the 30 s encoder."""
    if CTX not in size:
        return None
    return int(size.split(CTX)[1] or WINDOW_STEP_S)


def window_samples(samples: np.ndarray, min_s: int) -> int:
    """Samples the windowed mel covers: the turn rounded up to a step, at least `min_s`, at most 30 s."""
    step = WINDOW_STEP_S * RATE
    return min(30 * RATE, max(min_s * RATE, -(-len(samples) // step) * step))


def windowed_encoder(snapshot: Path) -> Path:
    """The turn-length encoder, written once next to the pinned one."""
    target = snapshot / "onnx" / "encoder_model.window.onnx"
    if not target.exists():
        import onnx

        from window import window

        onnx.save(window(onnx.load(snapshot / "onnx" / "encoder_model.onnx")), target)
    return target


class OnnxWhisperLid:
    def __init__(self, snapshot: Path, threads: int, min_s: int | None = None) -> None:
        import onnxruntime as ort
        from transformers import WhisperFeatureExtractor

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self.min_s = min_s
        self.features = WhisperFeatureExtractor.from_pretrained(snapshot)
        encoder = windowed_encoder(snapshot) if min_s is not None else snapshot / "onnx" / "encoder_model.onnx"
        self.encoder = ort.InferenceSession(str(encoder), options)
        self.decoder = ort.InferenceSession(str(snapshot / "onnx" / "decoder_model.onnx"), options)
        vocab = {t["content"]: t["id"] for t in json.loads((snapshot / "tokenizer.json").read_text())["added_tokens"]}
        self.sot = vocab[SOT]
        self.lang_ids = {lang: vocab[token] for lang, token in LANG_TOKENS.items()}

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        extra = {"max_length": window_samples(samples, self.min_s)} if self.min_s is not None else {}
        mel = self.features(samples, sampling_rate=RATE, return_tensors="np", **extra).input_features.astype(np.float32)
        hidden = self.encoder.run(None, {"input_features": mel})[0]
        logits = self.decoder.run(None, {"input_ids": np.array([[self.sot]], dtype=np.int64),
                                         "encoder_hidden_states": hidden})[0][0, -1]
        picked = np.array([logits[self.lang_ids[lang]] for lang in LANG_TOKENS], dtype=np.float64)
        picked = np.exp(picked - picked.max())
        return dict(zip(LANG_TOKENS, (picked / picked.sum()).tolist()))


class FasterWhisperLid:
    """Reference only. Its full language distribution, masked to the three.

    The mel is Whisper's own (audio padded to 30 s, then the log-mel), handed in
    as `features`. Given audio, `detect_language` computes the log-mel of the
    unpadded clip and pads the FEATURES with zeros, which is not silence after
    Whisper's normalisation: that alone put the ONNX runtime 0.13-0.18 away on
    short clips while the two models agree to 1e-5 on the same mel.
    """

    def __init__(self, snapshot: Path, threads: int, min_s: int | None = None) -> None:
        from faster_whisper import WhisperModel

        self.model = WhisperModel(str(snapshot), device="cpu", compute_type="float32", cpu_threads=threads)
        self.features = self.model.feature_extractor
        self.min_s = min_s

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        n = window_samples(samples, self.min_s) if self.min_s is not None else self.features.n_samples
        mel = self.features(samples, padding=n)[:, : n // self.features.hop_length]
        _, _, all_probs = self.model.detect_language(features=mel)
        return {lang: p for lang, p in all_probs if lang in LANG_TOKENS}


def parity_check(size: str, manifest: Path, out: Path, threads: int) -> None:
    """Reference vs runtime on the parity clips; its own process (see main).

    A `_ctx` size (any floor) has no external reference: CTranslate2 pads features with
    zeros to 3000 frames inside the encoder (measured: its answer on a short mel
    equals the 30 s ONNX encoder's on that mel zero-padded), so it never runs a
    short window. The check is then that the rewritten graph IS Whisper: fed
    the full 3000 frames it must answer as the pinned encoder does. The only
    change left is the window length, and its effect on accuracy is what the
    gate measures."""
    clips = [t for t in load(manifest) if not t.noise][: parity.PARITY_CLIPS]
    pin = PINS[base_size(size)]
    if min_window_s(size) is not None:
        import onnxruntime as ort

        snapshot = pinned.fetch(pin["runtime"])
        reference, runtime = OnnxWhisperLid(snapshot, threads), OnnxWhisperLid(snapshot, threads)
        runtime.encoder = ort.InferenceSession(str(windowed_encoder(snapshot)), runtime.encoder.get_session_options())
        report_extra = {"reference": "pinned ONNX encoder; windowed graph fed the same 3000 frames"}
    else:
        runtime = OnnxWhisperLid(pinned.fetch(pin["runtime"]), threads)
        reference = FasterWhisperLid(pinned.fetch(pin["reference"]), threads)
        report_extra = {"reference": "faster-whisper on the same 30 s mel"}
    ref = {t.id: arm_io.restrict(reference(read_wav(BENCH_ROOT / t.audio))) for t in clips}
    run = {t.id: arm_io.restrict(runtime(read_wav(BENCH_ROOT / t.audio))) for t in clips}
    arm_io.write_parity(f"whisper_probs_{size}", out, {**parity.compare(ref, run).as_dict(), **report_extra})


def score(size: str, manifest: Path, out: Path, prefixes: list[int], threads: int) -> None:
    arm = f"whisper_probs_{size}"
    passed = json.loads((out / f"{arm}.parity.json").read_text())["passed"]
    baseline = arm_io.rss_mib()
    pin, min_s = PINS[base_size(size)], min_window_s(size)
    runtime = OnnxWhisperLid(pinned.fetch(pin["runtime"]), threads, min_s)
    window_note = (f"encoder cut to the turn, rounded up to {WINDOW_STEP_S} s, at least {min_s} s (window.py)"
                   if min_s is not None
                   else "30 s padded window per call, so latency does not shrink with the prefix")
    arm_io.run(arm, runtime, manifest, out, prefixes, {
        "kind": "lid-model", "runtime": "onnxruntime-1.27.0", "parity_passed": passed,
        "needs_gpu": False, "needs_torch": False, "new_model": True,
        "notes": [f"onnx-community whisper-{base_size(size)}@{pin['runtime']['revision'][:8]}", window_note],
    }, baseline)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefixes", default="")
    parser.add_argument("--sizes", default=",".join(PINS))
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--stage", choices=("all", "parity", "score"), default="all")
    args = parser.parse_args()
    prefixes = [int(p) for p in args.prefixes.split(",") if p]
    sizes = args.sizes.split(",")
    if args.stage == "parity":
        parity_check(sizes[0], args.manifest, args.out, args.threads)
        return 0
    if args.stage == "score":
        score(sizes[0], args.manifest, args.out, prefixes, args.threads)
        return 0
    # Every size and both stages in a process of their own: peak RSS only ever
    # grows, so a reference model or a bigger size loaded earlier would be
    # billed to whatever is scored after it.
    base = [sys.executable, __file__, "--manifest", str(args.manifest), "--out", str(args.out),
            "--prefixes", args.prefixes, "--threads", str(args.threads)]
    for size in sizes:
        for stage, output in (("parity", "parity.json"), ("score", "scores.jsonl")):
            if (args.out / f"whisper_probs_{size}.{output}").exists():
                continue  # an interrupted run's finished stage; arm_io resumes a half-done score
            subprocess.run([*base, "--sizes", size, "--stage", stage], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
