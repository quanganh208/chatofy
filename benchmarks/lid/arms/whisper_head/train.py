"""Arm `whisper_head`: a vi/en/zh classifier on the Whisper-base encoder states.

    uv run --frozen python arms/whisper_head/train.py --run-tag <tag> \\
        --features data/features/<a>.npz [--features data/features/<b>.npz] [--eval-only ramc]

The sidecar already encodes every turn to decide its language, then reads a
single decoder token and discards the rest. This arm keeps the rest: the
pooled encoder states (`dump_features.py`) plus that token's three
log-probabilities go into a logistic regression, the same model and settings
as arm 4's classifier (`lid_bench.classifier`), one for finals (whole turns)
and one for partials (prefixes), as arm 4 found a shared one overconfident on
short audio.

Every probability written is OUT OF FOLD, leave one corpus out: a turn is
scored by a model that never saw its corpus. A re-recorded copy belongs to
the corpus of the turn it was played from, so its original never trains the
model that scores it. `--eval-only` groups (a corpus whose licence allows
measuring but not training on it) never train any model; they are scored by
the model trained on everything else. Turns ruler v5 leaves out (no language)
and noise never train a model either.

Writes `<run>/whisper_head.scores.jsonl` (the `probs` shape every model arm
writes, so the scorer treats it like any other) and `whisper_head.meta.json`
with `cv: logo`, plus the all-data models as `whisper_head.model.npz`, the
artifact the sidecar would load.
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

from lid_bench.classifier import _model  # noqa: E402
from lid_bench.manifest import LANGUAGES, load, opaque_id  # noqa: E402
from lid_bench.run_data import load_facts  # noqa: E402
from score import no_language_turns  # noqa: E402

ARM = "whisper_head"
CLASSES = tuple(sorted(LANGUAGES))
FULL_KEY = "+".join(CLASSES)
#: The scores this arm's features were checked against: same audio, same
#: encoder, so its speech measurements and latency are reused.
BASE_ARM = "whisper_probs_base_ctx5"


def load_features(paths: list[Path]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ids, prefixes, blocks = [], [], []
    for path in paths:
        data = np.load(path)
        if tuple(data["languages"]) != tuple(LANGUAGES):
            raise SystemExit(f"{path}: language order {tuple(data['languages'])} != {LANGUAGES}")
        ids.append(data["ids"])
        prefixes.append(data["prefix_ms"])
        blocks.append(data["X"])
    return np.concatenate(ids), np.concatenate(prefixes), np.concatenate(blocks)


def corpus_groups(turns) -> dict[str, str]:
    """Turn id -> the corpus it counts as, a re-recorded copy as its origin's."""
    group = {t.id: t.group for t in turns}
    origin = {opaque_id("rerecorded", t.id): t.group for t in turns if t.group != "rerecorded"}
    return {tid: origin.get(tid, g) if g == "rerecorded" else g for tid, g in group.items()}


def fit(X: np.ndarray, y: np.ndarray):
    scaler, model = _model()
    model.fit(scaler.fit_transform(X), y)
    return scaler, model


def predict(fitted, X: np.ndarray) -> np.ndarray:
    scaler, model = fitted
    probs = model.predict_proba(scaler.transform(X))
    out = np.zeros((len(X), len(CLASSES)))
    for column, label in enumerate(model.classes_):
        out[:, CLASSES.index(label)] = probs[:, column]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-tag", required=True)
    parser.add_argument("--features", type=Path, action="append", required=True)
    parser.add_argument("--eval-only", default="", help="comma-separated groups that never train")
    args = parser.parse_args()

    run_dir = BENCH_ROOT / "results" / args.run_tag
    turns = {t.id: t for t in load(run_dir / "manifest.jsonl")}
    groups = corpus_groups(turns.values())
    eval_only = {g for g in args.eval_only.split(",") if g}
    excluded = no_language_turns(list(turns.values()), load_facts(run_dir))

    ids, prefix_ms, X = load_features([p if p.is_absolute() else BENCH_ROOT / p for p in args.features])
    keep = np.array([tid in turns for tid in ids])
    ids, prefix_ms, X = ids[keep], prefix_ms[keep], X[keep]
    missing = set(turns) - set(ids.tolist())
    if missing:
        raise SystemExit(f"{len(missing)} manifest turns have no features (first: {sorted(missing)[0]})")
    lang = np.array([turns[t].lang for t in ids])
    group = np.array([groups[t] for t in ids])
    trains = np.array([not turns[t].noise and t not in excluded and groups[t] not in eval_only and l in CLASSES
                       for t, l in zip(ids, lang)])

    probs = np.zeros((len(ids), len(CLASSES)))
    started = time.perf_counter()
    models = {}
    for stage, rows in (("final", prefix_ms < 0), ("partial", prefix_ms >= 0)):
        stage_rows = np.where(rows)[0]
        stage_train = stage_rows[trains[stage_rows]]
        held = sorted(set(group[stage_train]))
        for g in held:
            train = stage_train[group[stage_train] != g]
            test = stage_rows[group[stage_rows] == g]
            probs[test] = predict(fit(X[train], lang[train]), X[test])
            print(f"{stage}: held out {g} ({len(test)} rows), {time.perf_counter() - started:.0f} s", flush=True)
        everything = fit(X[stage_train], lang[stage_train])
        # Groups that never trained (eval-only, noise-only) are scored by the
        # model trained on everything: nothing of theirs is in it.
        unseen = stage_rows[~np.isin(group[stage_rows], held)]
        if unseen.size:
            probs[unseen] = predict(everything, X[unseen])
        scaler, model = everything
        models[stage] = {"mean": scaler.mean_, "scale": scaler.scale_, "coef": model.coef_,
                         "intercept": model.intercept_, "classes": np.array(model.classes_)}

    base = {}
    for line in (run_dir / f"{BASE_ARM}.scores.jsonl").read_text().splitlines():
        row = json.loads(line)
        base[(row["id"], row["prefix_ms"])] = row
    with (run_dir / f"{ARM}.scores.jsonl").open("w") as fh:
        for tid, ms, p in zip(ids, prefix_ms, probs):
            key = (str(tid), None if ms < 0 else int(ms))
            ref = base[key]
            fh.write(json.dumps({"id": key[0], "prefix_ms": key[1], "speech_ms": ref["speech_ms"],
                                 "probs": {FULL_KEY: dict(zip(CLASSES, p.round(6).tolist()))},
                                 # The head is one matrix product on top of the encoder pass.
                                 "latency_ms": ref["latency_ms"]}) + "\n")
    np.savez(run_dir / f"{ARM}.model.npz", **{f"{stage}_{k}": v for stage, m in models.items() for k, v in m.items()})
    base_meta = json.loads((run_dir / f"{BASE_ARM}.meta.json").read_text())
    meta = {"arm": ARM, "kind": "lid-model", "runtime": "onnxruntime-1.27.0", "parity_passed": None,
            "needs_gpu": False, "needs_torch": False, "new_model": True, "cv": "logo",
            "rss_peak_mib": base_meta.get("rss_peak_mib"), "rss_delta_mib": base_meta.get("rss_delta_mib"),
            "notes": [f"features from the sidecar's own Whisper-base path; its token probabilities match "
                      f"{BASE_ARM} to 1.2e-7",
                      "logistic regression (arm 4's settings), final and partial models, leave one corpus out",
                      f"eval-only groups: {sorted(eval_only) or 'none'}; v5-excluded turns never train"]}
    (run_dir / f"{ARM}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {len(ids)} rows to {run_dir.relative_to(BENCH_ROOT)}/{ARM}.scores.jsonl")
    return 0


if __name__ == "__main__":
    sys.exit(main())
