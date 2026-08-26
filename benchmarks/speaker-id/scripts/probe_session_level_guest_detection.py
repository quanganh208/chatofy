"""Can a whole session notice a stranger that no single turn can?

Per-turn guest handling failed and failed structurally: 67.6% of an unenrolled
guest's turns are attributed to an enrolled participant, and sweeping the
new-speaker threshold to its limit still leaves 50.8% stolen while costing
enrolled accuracy 11 points. There is no operating point.

But that asked the hardest possible question — decide, from one 2s turn, whether
this voice is someone new. A product does not need that. It needs to know
*whether somebody in this meeting has not enrolled*, once, and then it can ask
them to. That question has ~25 turns of evidence behind it instead of one.

**The statistic.** Collect the turns that matched no centroid well (best cosine
below `tau_assign`) and ask whether they resemble EACH OTHER. A guest emits a
coherent group of unmatched turns — same voice every time. An enrolled speaker's
occasional weak turn does not; leftovers from different people point in
different directions. So the signal is the internal coherence of the unmatched
pool, not its size.

Size is measured too, as the baseline to beat: if simply counting unmatched turns
detects the guest just as well, the coherence idea is decoration.

**The comparison is matched.** Both arms have five speakers and 25 turns in the
same order; the only difference is whether the fifth person's centroid was
seeded. Anything else would let turn count or meeting size masquerade as
detection.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_session_level_guest_detection.py
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from run_session import (  # noqa: E402
    ENROLL_TURNS,
    MEETING_TURNS,
    load_cache,
    speaker_rows,
    split_speakers,
)
sys.path.insert(0, str(BENCH_ROOT / "scripts"))

from probe_unenrolled_guest import read_thresholds  # noqa: E402

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")
PARTY_SIZE = 5
MEETINGS = 400

#: False-alarm rate the detection rate is quoted at. A prompt that wrongly asks a
#: fully enrolled meeting to enrol somebody is annoying but recoverable, so 5% is
#: a tolerable operating point rather than a strict one.
FALSE_ALARM = 0.05


def coherence(unmatched: list[np.ndarray]) -> float:
    """How much the unmatched turns look like one another.

    Each unmatched turn's best cosine to ANOTHER unmatched turn, averaged. A
    guest's turns find each other; scattered leftovers do not. Fewer than two
    unmatched turns means there is nothing to be coherent about, which is itself
    evidence of no guest.
    """
    if len(unmatched) < 2:
        return 0.0
    matrix = np.stack(unmatched)
    similarity = matrix @ matrix.T
    np.fill_diagonal(similarity, -np.inf)
    return float(np.mean(np.max(similarity, axis=1)))


def run_arm(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    guest: bool,
    tau_assign: float,
    rng: random.Random,
) -> tuple[list[float], list[float]]:
    """Return (coherence, unmatched fraction) per meeting for one arm."""
    coherences, fractions = [], []
    for _ in range(MEETINGS):
        members = rng.sample(names, PARTY_SIZE)
        # With a guest, the first member is present but never enrolled.
        seated = members[1:] if guest else members

        centroids = []
        for person in seated:
            enrolment = vectors[pool[person][:ENROLL_TURNS]].mean(axis=0)
            centroids.append((enrolment / np.linalg.norm(enrolment)).astype(np.float32))
        bank = np.stack(centroids)

        schedule = [
            row
            for person in members
            for row in pool[person][ENROLL_TURNS : ENROLL_TURNS + MEETING_TURNS]
        ]
        rng.shuffle(schedule)

        # Scored against the ENROLLED centroids only, frozen as seeded. Letting
        # them drift mid-session would fold the guest's own turns into the
        # centroids the guest is being compared against, which is the leakage
        # this detector exists to avoid.
        unmatched = [
            vectors[row] for row in schedule if float(np.max(bank @ vectors[row])) < tau_assign
        ]
        coherences.append(coherence(unmatched))
        fractions.append(len(unmatched) / len(schedule))
    return coherences, fractions


def separation(with_guest: list[float], without: list[float]) -> tuple[float, float]:
    """AUC, and detection rate at the fixed false-alarm rate."""
    positive = np.asarray(with_guest)
    negative = np.asarray(without)
    # AUC as the probability a guest meeting outscores a guest-free one, ties half.
    comparisons = positive[:, None] - negative[None, :]
    auc = float((np.sum(comparisons > 0) + 0.5 * np.sum(comparisons == 0)) / comparisons.size)
    threshold = float(np.quantile(negative, 1.0 - FALSE_ALARM))
    return auc, float(np.mean(positive > threshold))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument(
        "--session", type=Path, default=BENCH_ROOT / "results" / "session-summary.csv"
    )
    parser.add_argument(
        "--out", type=Path, default=BENCH_ROOT / "results" / "session-guest-detection.csv"
    )
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    cache = load_cache(args.cache)
    pool = speaker_rows(cache)
    _, evaluation_names = split_speakers(list(pool), random.Random(args.seed))
    thresholds = read_thresholds(args.session)
    print(
        f"{len(evaluation_names)} evaluation speakers, {PARTY_SIZE}-person meetings, "
        f"{MEETINGS} per arm, detection quoted at {FALSE_ALARM:.0%} false alarm\n",
        flush=True,
    )

    rows = []
    for model in MODELS:
        for condition in CONDITIONS:
            key = (model, condition, PARTY_SIZE)
            if key not in thresholds:
                print(f"  no calibrated thresholds for {key}; skipped", flush=True)
                continue
            tau_assign, _ = thresholds[key]
            vectors = cache[f"vec/{model}/{condition}"]

            guest_coherence, guest_fraction = run_arm(
                vectors, pool, evaluation_names, guest=True,
                tau_assign=tau_assign, rng=random.Random(args.seed),
            )
            clean_coherence, clean_fraction = run_arm(
                vectors, pool, evaluation_names, guest=False,
                tau_assign=tau_assign, rng=random.Random(args.seed),
            )

            coherence_auc, coherence_hit = separation(guest_coherence, clean_coherence)
            fraction_auc, fraction_hit = separation(guest_fraction, clean_fraction)

            rows.append({
                "model": model, "condition": condition, "tau_assign": f"{tau_assign:.4f}",
                "coherence_auc": f"{coherence_auc:.4f}",
                "coherence_detection": f"{coherence_hit:.4f}",
                "unmatched_fraction_auc": f"{fraction_auc:.4f}",
                "unmatched_fraction_detection": f"{fraction_hit:.4f}",
                "meetings_per_arm": MEETINGS,
                "speakers": len(evaluation_names),
            })
            print(
                f"  {model:12s} {condition:10s}  "
                f"coherence AUC {coherence_auc:.3f}, detect {coherence_hit * 100:5.1f}%   |   "
                f"unmatched-count AUC {fraction_auc:.3f}, detect {fraction_hit * 100:5.1f}%",
                flush=True,
            )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    gate = [r for r in rows if r["condition"] == "far-field"]
    best = max(gate, key=lambda r: float(r["coherence_detection"]))
    print("=" * 78, flush=True)
    print(
        f"far-field, 5-person meeting: best session-level detection is "
        f"{float(best['coherence_detection']) * 100:.1f}% of meetings containing an unenrolled\n"
        f"speaker, at a {FALSE_ALARM:.0%} false-alarm rate ({best['model']}, "
        f"AUC {float(best['coherence_auc']):.3f}).",
        flush=True,
    )
    if float(best["coherence_detection"]) < float(best["unmatched_fraction_detection"]):
        print(
            "Note: simply COUNTING unmatched turns does better than measuring their coherence,\n"
            "so the coherence idea does not earn its complexity here.",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
