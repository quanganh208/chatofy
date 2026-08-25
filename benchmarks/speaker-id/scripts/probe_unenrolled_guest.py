"""What happens to someone who did not enrol?

Every measurement so far has been closed-set: the enrolment probe scored a choice
among N known people, and the session bench's warm mode seeds everyone who
speaks. Neither has ever seen a voice it was not told about. In the two-mode
product that gap is not academic — a meeting where most people enrolled and one
guest did not is the ordinary case, not the edge case.

Three things can go wrong, and they are not equally bad:

* **Stolen.** The guest is assigned to an enrolled person's cluster. Worst
  outcome: their words appear under somebody else's name, and the wrong turn is
  folded into that person's centroid, so the damage persists.
* **Undecided.** The guest lands in the dead zone. Their turns carry no label —
  honest, and recoverable.
* **New cluster.** The guest gets their own unnamed cluster. This is the correct
  behaviour, and the product can then offer to name it.

It also measures the reverse error: how often an *enrolled* speaker spuriously
starts a new cluster, which is what a threshold tuned to protect against theft
would cost.

Thresholds come from the session bench's calibration rather than being re-tuned
here — the question is how the shipping configuration behaves with a guest, not
what configuration would handle guests best if guests were all that mattered.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_unenrolled_guest.py
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
from speaker_bench.online import OnlineAttributor  # noqa: E402

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")

#: Enrolled participants, plus exactly one guest on top.
ENROLLED_SIZES = (2, 4)
MEETINGS = 500


def read_thresholds(path: Path) -> dict[tuple[str, str, int], tuple[float, float]]:
    """The warm-start thresholds the session bench calibrated, per cell."""
    chosen: dict[tuple[str, str, int], list[tuple[float, float]]] = {}
    with path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["start"] != "warm":
                continue
            key = (row["model"], row["condition"], int(row["meeting_size"]))
            chosen.setdefault(key, []).append(
                (float(row["tau_assign"]), float(row["tau_new"]))
            )
    # Several splits calibrate each cell; take the median of each threshold so one
    # unlucky split does not set the configuration this probe reports on.
    return {
        key: (float(np.median([t[0] for t in pairs])), float(np.median([t[1] for t in pairs])))
        for key, pairs in chosen.items()
    }


def sweep_new_speaker_threshold(cache, pool, names, thresholds) -> None:
    """Can a guest be given their own cluster without wrecking enrolled turns?

    The shipping thresholds were calibrated on closed-set meetings, where
    starting a new speaker is almost always the wrong answer, so `tau_new` sits
    very low and a guest has nowhere to go but somebody else's cluster. The
    question is whether that is a fixable calibration choice or a real conflict:
    raising `tau_new` opens the door for guests, but the same door lets an
    enrolled speaker's weak turn wander off into a cluster of its own.

    `tau_assign` is held at its calibrated value — the enrolled-mode result
    depends on it and is not up for renegotiation here — and only `tau_new`
    moves. The spurious-new rate measured above is 0.0-0.1%, so there is room on
    paper; this measures what the room actually buys.
    """
    model, condition, enrolled = "campplus", "far-field", 4
    tau_assign, tau_new_calibrated = thresholds[(model, condition, enrolled + 1)]
    vectors = cache[f"vec/{model}/{condition}"]

    print(
        f"\nnew-speaker threshold sweep ({model}, {condition}, {enrolled} enrolled + 1 guest, "
        f"tau_assign held at {tau_assign:.3f}; calibrated tau_new was {tau_new_calibrated:.3f})",
        flush=True,
    )
    print("  tau_new   guest own-cluster   guest stolen   enrolled acc   spurious-new", flush=True)

    for tau_new in np.round(np.arange(tau_new_calibrated, tau_assign + 0.001, 0.05), 4):
        rng = random.Random(20260825)
        stolen = own = 0
        enrolled_correct = enrolled_attributed = enrolled_split = 0
        for _ in range(300):
            members = rng.sample(names, enrolled + 1)
            guest, seated = members[0], members[1:]
            attributor = OnlineAttributor(tau_assign=tau_assign, tau_new=float(tau_new))
            seeded = {}
            for person in seated:
                enrolment = vectors[pool[person][:ENROLL_TURNS]].mean(axis=0)
                seeded[attributor.seed(
                    (enrolment / np.linalg.norm(enrolment)).astype(np.float32)
                )] = person
            schedule = [
                (person, row)
                for person in members
                for row in pool[person][ENROLL_TURNS : ENROLL_TURNS + MEETING_TURNS]
            ]
            rng.shuffle(schedule)
            for person, row in schedule:
                assignment = attributor.observe(vectors[row])
                if person == guest:
                    if assignment.label in seeded:
                        stolen += 1
                    elif assignment.label is not None:
                        own += 1
                elif assignment.label is not None:
                    enrolled_attributed += 1
                    if assignment.label in seeded:
                        enrolled_correct += int(seeded[assignment.label] == person)
                    else:
                        enrolled_split += 1
        guest_turns = 300 * MEETING_TURNS
        print(
            f"  {tau_new:.3f}      {100 * own / guest_turns:5.1f}%           "
            f"{100 * stolen / guest_turns:5.1f}%        "
            f"{100 * enrolled_correct / enrolled_attributed:5.1f}%        "
            f"{100 * enrolled_split / enrolled_attributed:5.1f}%",
            flush=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument(
        "--session", type=Path, default=BENCH_ROOT / "results" / "session-summary.csv"
    )
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "guest-summary.csv")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    cache = load_cache(args.cache)
    pool = speaker_rows(cache)
    _, evaluation_names = split_speakers(list(pool), random.Random(args.seed))
    thresholds = read_thresholds(args.session)
    print(f"{len(evaluation_names)} evaluation speakers; one is the guest each meeting\n", flush=True)

    rows = []
    for model in MODELS:
        for condition in CONDITIONS:
            vectors = cache[f"vec/{model}/{condition}"]
            for enrolled in ENROLLED_SIZES:
                key = (model, condition, enrolled + 1)
                if key not in thresholds:
                    print(f"  no calibrated thresholds for {key}; skipped", flush=True)
                    continue
                tau_assign, tau_new = thresholds[key]
                rng = random.Random(args.seed + enrolled)

                stolen = undecided = own_cluster = 0
                enrolled_correct = enrolled_attributed = enrolled_split = 0

                for _ in range(MEETINGS):
                    members = rng.sample(evaluation_names, enrolled + 1)
                    guest, seated = members[0], members[1:]

                    attributor = OnlineAttributor(tau_assign=tau_assign, tau_new=tau_new)
                    seeded = {}
                    for person in seated:
                        enrolment = vectors[pool[person][:ENROLL_TURNS]].mean(axis=0)
                        label = attributor.seed(
                            (enrolment / np.linalg.norm(enrolment)).astype(np.float32)
                        )
                        seeded[label] = person

                    schedule = [
                        (person, row)
                        for person in members
                        for row in pool[person][ENROLL_TURNS : ENROLL_TURNS + MEETING_TURNS]
                    ]
                    rng.shuffle(schedule)

                    for person, row in schedule:
                        assignment = attributor.observe(vectors[row])
                        if person == guest:
                            if assignment.label is None:
                                undecided += 1
                            elif assignment.label in seeded:
                                stolen += 1
                            else:
                                own_cluster += 1
                        else:
                            if assignment.label is None:
                                continue
                            enrolled_attributed += 1
                            if assignment.label in seeded:
                                enrolled_correct += int(seeded[assignment.label] == person)
                            else:
                                enrolled_split += 1

                guest_turns = stolen + undecided + own_cluster
                rows.append({
                    "model": model, "condition": condition,
                    "enrolled": enrolled, "guest_turns": guest_turns,
                    "stolen": f"{stolen / guest_turns:.6f}",
                    "undecided": f"{undecided / guest_turns:.6f}",
                    "own_cluster": f"{own_cluster / guest_turns:.6f}",
                    "enrolled_accuracy": f"{enrolled_correct / enrolled_attributed:.6f}",
                    "enrolled_spurious_new": f"{enrolled_split / enrolled_attributed:.6f}",
                    "tau_assign": f"{tau_assign:.4f}", "tau_new": f"{tau_new:.4f}",
                })
                print(
                    f"  {model:12s} {condition:10s} {enrolled} enrolled + 1 guest:  "
                    f"guest stolen {100 * stolen / guest_turns:5.1f}%  "
                    f"undecided {100 * undecided / guest_turns:5.1f}%  "
                    f"own cluster {100 * own_cluster / guest_turns:5.1f}%   |   "
                    f"enrolled acc {100 * enrolled_correct / enrolled_attributed:5.1f}%  "
                    f"spurious-new {100 * enrolled_split / enrolled_attributed:4.1f}%",
                    flush=True,
                )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    sweep_new_speaker_threshold(cache, pool, evaluation_names, thresholds)

    worst = max(rows, key=lambda r: float(r["stolen"]))
    print("=" * 78, flush=True)
    print(
        f"WORST THEFT RATE: {float(worst['stolen']) * 100:.1f}% of an unenrolled guest's turns are\n"
        f"attributed to an enrolled participant ({worst['model']}, {worst['condition']}, "
        f"{worst['enrolled']} enrolled).\n"
        "Theft is the outcome that puts words under the wrong name AND corrupts that\n"
        "person's centroid, so this is the number the guest story lives or dies on.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
