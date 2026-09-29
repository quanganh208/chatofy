"""Score a clusterer config on the attribution rulers, through the shipped reducer.

Four rulers, one row each: `viyt/clean` and `viyt/far` (100 real ViYT-Diar
dialogues), `prod` (8 old browser recordings) — all three from
`rulers/viyt-diar/results/rulers.pkl` — and `conversations/<id>` (the five
real webms from `rulers/conversations/ruler.json`, built by phase 04; skipped
here until that file exists).

The engine is `client_pipeline.run_client_pipeline`, which drives the real
shipped TypeScript reducer through `scripts/attribution-reference.mjs
--pipeline`. Nothing here re-implements the clusterer.

**The gate proxy.** ViYT and old prod have no audio, so Silero cannot run on
them; the proxy is each turn's annotated `speech_ms` — a turn under
`--min-speech-ms` is not observed by the clusterer and takes the previous
turn's label, and still counts in the score (plan.md, phase 02 Context). The
conversation ruler has real audio, so its gate value is the sidecar's measured
`sileroMs` instead; the two rulers use the same `--min-speech-ms` argument
against different fields, both fed through the same
`run_client_pipeline(..., speech_ms=<gate field>)` call.

`--min-speech-ms 0` reproduces the scratch `sim.py`/`viyt.py` fidelity numbers
(nothing gated); `--min-speech-ms 300` is the product value and reports the
lost-turn / lost-speech pair phase 09's rollout gate reads.

Usage:
    uv run python run_attribution_rulers.py --config shipped
    uv run python run_attribution_rulers.py --config 0.50/0.45 --min-speech-ms 300
    uv run python run_attribution_rulers.py --config 0.50/0.45 --perturb 0.2 --seeds 20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pickle
import random
import statistics
from pathlib import Path
from typing import Any

from speaker_bench.client_pipeline import SHIPPED, run_client_pipeline
from speaker_bench.scoring import gate_loss, speech_weighted_score

BENCH_ROOT = Path(__file__).resolve().parent
RULERS_DIR = BENCH_ROOT / "rulers"
SHA256SUMS_PATH = RULERS_DIR / "SHA256SUMS"
PKL_PATH = RULERS_DIR / "viyt-diar" / "results" / "rulers.pkl"
CONVERSATION_RULER_PATH = RULERS_DIR / "conversations" / "ruler.json"

#: The rulers this plan's acceptance numbers are measured against.
#: `vox/...` lives in the same pickle but is not one of the "four rulers" this
#: plan cites (VoxVietnam-Diar has an unresolved label-noise floor of its own —
#: see the module `--pipeline` docstring), so it is left out of every row.
PKL_RULERS = ("viyt/clean", "viyt/far", "prod")

#: `--config` choices. `SHIPPED` is `client_pipeline.SHIPPED`, so phase 06
#: flipping it there flips what `shipped` means here too.
CONFIGS: dict[str, dict[str, float | int]] = {
    "shipped": SHIPPED,
    "0.50/0.45": {"tau_assign": 0.50, "tau_new": 0.45, "k_max": 2, "mint_confirmations": 2},
}


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def _verify_pkl_sha256() -> None:
    """`rulers.pkl` is a pickle of real people's voices; nothing unpickles it unverified."""
    relative = PKL_PATH.relative_to(RULERS_DIR).as_posix()
    expected = None
    for line in SHA256SUMS_PATH.read_text().splitlines():
        digest, _, name = line.partition("  ")
        if name == relative:
            expected = digest
            break
    if expected is None:
        raise RuntimeError(f"{relative} has no entry in {SHA256SUMS_PATH}")
    actual = _sha256(PKL_PATH)
    if actual != expected:
        raise RuntimeError(
            f"{relative}: sha256 mismatch\n  expected {expected}\n  actual   {actual}\n"
            "The restored ruler is not the one SHA256SUMS pins. Do not score against it."
        )


def _load_pkl_rulers() -> dict[str, list[dict[str, Any]]]:
    _verify_pkl_sha256()
    with PKL_PATH.open("rb") as handle:
        rulers = pickle.load(handle)  # noqa: S301 -- verified above
    return {
        name: [
            {
                "vectors": [[float(value) for value in vector] for vector in meeting["cam"]],
                # ViYT/prod use the same field as the gate proxy and the score
                # weight -- see the module docstring.
                "gate_ms": [float(ms) for ms in meeting["speech_ms"]],
                "truth": [str(label) for label in meeting["truth"]],
                "speech_s": [float(ms) / 1000.0 for ms in meeting["speech_ms"]],
            }
            for meeting in rulers[name]
        ]
        for name in PKL_RULERS
        if name in rulers
    }


def _load_conversation_ruler() -> dict[str, list[dict[str, Any]]]:
    """`rulers/conversations/ruler.json`, if phase 04 has built it yet.

    Schema, per phase-04's spec: `{cid: [{start,end,truth,speech,vec,sileroMs,
    gatedText}]}`. `speech` is already ground-truth seconds (`embwin.py:15-22`);
    `sileroMs` is the sidecar's measured speech, which is the gate value here
    instead of an annotated proxy.
    """
    if not CONVERSATION_RULER_PATH.exists():
        return {}
    raw = json.loads(CONVERSATION_RULER_PATH.read_text())
    return {
        f"conversations/{conversation_id}": [
            {
                "vectors": [window.get("vec") for window in windows],
                "gate_ms": [float(window["sileroMs"]) for window in windows],
                "truth": [str(window["truth"]) for window in windows],
                "speech_s": [float(window["speech"]) for window in windows],
            }
        ]
        for conversation_id, windows in raw.items()
    }


def _perturb_order(turn_count: int, probability: float, seed: int) -> list[int]:
    """One pass of adjacent swaps, each with `probability`, seeded for reproducibility.

    Arrival order is not turn order in production -- embeddings land after the
    final and per split piece, with several turns in flight (plan.md, phase 02
    Context) -- so this measures how much a plausible reordering moves the
    score. Not a shuffle: a full shuffle would test an arrival pattern the
    product cannot produce.
    """
    rng = random.Random(seed)
    order = list(range(turn_count))
    for index in range(turn_count - 1):
        if rng.random() < probability:
            order[index], order[index + 1] = order[index + 1], order[index]
    return order


def score_meeting(
    meeting: dict[str, Any],
    config: dict[str, float | int],
    min_speech_ms: float,
    *,
    order: list[int] | None = None,
) -> tuple[float, bool]:
    labels = run_client_pipeline(
        meeting["vectors"], meeting["gate_ms"], min_speech_ms=min_speech_ms, order=order, **config
    )
    accuracy, exact, _predicted, _true = speech_weighted_score(
        meeting["truth"], labels, meeting["speech_s"]
    )
    return accuracy, exact


def _print_ruler_row(
    name: str,
    meetings: list[dict[str, Any]],
    config: dict[str, float | int],
    min_speech_ms: float,
    perturb: float | None,
    seeds: int,
) -> None:
    accuracies: list[float] = []
    exact = 0
    lost_turns_total = turns_total = 0
    lost_speech_total = speech_total = 0.0
    for meeting in meetings:
        accuracy, is_exact = score_meeting(meeting, config, min_speech_ms)
        accuracies.append(accuracy)
        exact += int(is_exact)
        lost_turns, turns, lost_speech_s, speech_s = gate_loss(meeting["gate_ms"], min_speech_ms)
        lost_turns_total += lost_turns
        turns_total += turns
        lost_speech_total += lost_speech_s
        speech_total += speech_s

    mean_accuracy = statistics.mean(accuracies) if accuracies else 0.0
    lost_turn_pct = 100 * lost_turns_total / turns_total if turns_total else 0.0
    lost_speech_pct = 100 * lost_speech_total / speech_total if speech_total else 0.0
    print(
        f"{name:24s} acc {mean_accuracy:.3f}  exact {exact}/{len(meetings)}  "
        f"lost turns {lost_turns_total}/{turns_total} ({lost_turn_pct:.1f}%)  "
        f"lost speech {lost_speech_total:.1f}s/{speech_total:.1f}s ({lost_speech_pct:.1f}%)"
    )

    if perturb is None:
        return

    seed_accuracies: list[float] = []
    seed_exact_counts: list[int] = []
    for seed in range(seeds):
        accuracies = []
        exact = 0
        for meeting in meetings:
            order = _perturb_order(len(meeting["vectors"]), perturb, seed)
            accuracy, is_exact = score_meeting(meeting, config, min_speech_ms, order=order)
            accuracies.append(accuracy)
            exact += int(is_exact)
        seed_accuracies.append(statistics.mean(accuracies) if accuracies else 0.0)
        seed_exact_counts.append(exact)
    print(
        f"{'':24s} perturb p={perturb} seeds={seeds}: acc min {min(seed_accuracies):.3f} "
        f"median {statistics.median(seed_accuracies):.3f} max {max(seed_accuracies):.3f}  "
        f"exact min {min(seed_exact_counts)} median {statistics.median(seed_exact_counts):.1f} "
        f"max {max(seed_exact_counts)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", choices=sorted(CONFIGS), default="shipped")
    parser.add_argument(
        "--min-speech-ms",
        type=float,
        default=300.0,
        help="the product's speech floor; 0 reproduces the scratch fidelity numbers",
    )
    parser.add_argument(
        "--perturb", type=float, default=None, help="probability of swapping adjacent arrivals, per seed"
    )
    parser.add_argument("--seeds", type=int, default=20, help="seeds for --perturb")
    args = parser.parse_args()

    config = CONFIGS[args.config]
    rulers = _load_pkl_rulers()
    conversation_rulers = _load_conversation_ruler()
    if not conversation_rulers:
        print("(rulers/conversations/ruler.json not built yet -- conversation rows skipped)")
    rulers.update(conversation_rulers)

    print(f"config={args.config} min_speech_ms={args.min_speech_ms:g}")
    for name, meetings in rulers.items():
        _print_ruler_row(name, meetings, config, args.min_speech_ms, args.perturb, args.seeds)


if __name__ == "__main__":
    main()
