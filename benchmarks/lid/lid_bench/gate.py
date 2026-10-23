"""The machine verdict: which outcome G1-G5 the measurements put the plan in.

| Outcome | Meaning |
|---|---|
| G1 | a dedicated LID model, eligible to ship, passes everything |
| G2 | recognizer competition, eligible to ship, passes everything |
| G3 | an eligible arm passes every vi<->en criterion but not the zh ones |
| G4 | nothing passes; the plan stops |
| G5 | only an arm that needs what the sidecar lacks (a GPU, or torch at
  runtime) passes; stop and ask -- `notes` says which |
| INCOMPLETE | no eligible arm has every required criterion measured on the data
  it requires (none missing, none `public-substitute`), or its numbers came from
  an unsound validation (in-sample thresholds, or a classifier validated by
  k-fold instead of leave-one-group-out), or an arm in `PLANNED_ARMS` has
  not run -- not a verdict at all; `notes` keeps the provisional outcome |

"Eligible" is decided before any accuracy is looked at (`ArmInfo`): the arm
runs on the sidecar's pinned onnxruntime, its parity check passed when it has a
reference to be parity-checked against, it fit in the 4 GiB measurement cap,
and it needs neither a GPU nor torch at runtime.

Among passing eligible arms the winner is the one with the smallest p95 added
latency; within 20 ms the lower peak RSS; still tied, the one that needs no new
model.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from lid_bench.scoring import Result

# Every arm the bake-off compares. A verdict over fewer is provisional: the
# missing arm could pass where the others fail, or beat the winner on latency.
PLANNED_ARMS = ("recognizer_competition", "ambernet", "whisper_probs", "mms_lid")

REQUIRED_VIEN = (
    "A1.en-vi", "A2.en-vi", "A3.long.vien", "A3.short.vien", "A4", "A5",
    "A6.en-vi.first_language_p95_ms", "A6.en-vi.changed", "A7", "A-ACC.pair", "A-ACC.detect",
    "A9-mono.en", "A9-mono.vi",
)
#: zh's A2/A6 are reported per pair but not required: step 4 sets no short-turn
#: or real minimum for zh, so requiring them would make G1 unreachable by
#: construction rather than by measurement.
REQUIRED_ZH = ("A1.vi-zh", "A1.en-zh", "A3.long.zh", "A3.short.zh")
LATENCY_TIE_MS = 20.0


@dataclass(frozen=True)
class ArmInfo:
    arm: str
    kind: str  # "lid-model" | "recognizer"
    runtime: str  # e.g. "onnxruntime-1.27.0", "faster-whisper", "transformers"
    parity_passed: bool | None = None  # None: no reference to compare against
    needs_gpu: bool = False
    needs_torch: bool = False
    oom: bool = False
    rss_peak_mib: float | None = None
    #: Peak RSS minus the process's RSS before the arm loaded its model: what
    #: the sidecar would carry on top of today. Arm 4 loads no new weights, so 0.
    rss_delta_mib: float | None = None
    new_model: bool = True
    notes: list[str] = field(default_factory=list)

    @property
    def eligible(self) -> bool:
        return (self.runtime == "onnxruntime-1.27.0" and self.parity_passed is not False
                and not self.needs_gpu and not self.needs_torch and not self.oom)


def _passes(results: dict[str, Result], names: tuple[str, ...]) -> bool:
    return all(results.get(n) is not None and results[n].passed is True for n in names)


def _complete(results: dict[str, Result]) -> bool:
    return all(
        results.get(n) is not None and results[n].passed is not None and results[n].data != "public-substitute"
        for n in REQUIRED_VIEN + REQUIRED_ZH
    )


def verdict(per_arm: dict[str, dict[str, Result]], arms: dict[str, ArmInfo],
            unsound: frozenset[str] = frozenset(),
            planned: tuple[str, ...] = ()) -> tuple[str, str | None, list[str]]:
    """(outcome, winner, notes). `per_arm` keys are arm names in `arms`;
    `unsound` names arms whose numbers must not decide anything; `planned`
    names arms that must all have run for the outcome to stand."""
    outcome, winner, notes = _verdict(per_arm, arms, unsound)
    # An arm run at several sizes scores each as `<arm>_<size>`; any one counts.
    missing = [a for a in planned if not any(n == a or n.startswith(f"{a}_") for n in per_arm)]
    if missing:
        return "INCOMPLETE", None, notes + [f"provisional {outcome} (winner {winner}); not run: {missing}"]
    return outcome, winner, notes


def _verdict(per_arm: dict[str, dict[str, Result]], arms: dict[str, ArmInfo],
             unsound: frozenset[str]) -> tuple[str, str | None, list[str]]:
    complete = {a for a in per_arm if a not in unsound and _complete(per_arm[a])}
    eligible = [a for a in complete if arms[a].eligible]
    blocked = sorted(a for a in complete if (arms[a].needs_gpu or arms[a].needs_torch)
                     and _passes(per_arm[a], REQUIRED_VIEN + REQUIRED_ZH))
    notes = [f"{a} passes everything but needs {'a GPU' if arms[a].needs_gpu else 'torch'}" for a in blocked]
    if not eligible:
        if blocked:
            return "G5", None, notes
        # An eligible arm that is not fully measured is missing data; no
        # eligible arm at all (every arm failed parity, OOM'd, ...) is a result.
        if any(arms[a].eligible for a in per_arm):
            return "INCOMPLETE", None, [f"unsound: {sorted(unsound)}"] if unsound else []
        return "G4", None, notes

    def rank(name: str) -> tuple:
        added = per_arm[name]["A7"].value or 0.0
        info = arms[name]
        return (round(added / LATENCY_TIE_MS), info.rss_peak_mib or 0.0, info.new_model, name)

    full = [a for a in eligible if _passes(per_arm[a], REQUIRED_VIEN + REQUIRED_ZH)]
    if full:
        winner = min(full, key=rank)
        return ("G1" if arms[winner].kind == "lid-model" else "G2"), winner, []
    vien = [a for a in eligible if _passes(per_arm[a], REQUIRED_VIEN)]
    if vien:
        return "G3", min(vien, key=rank), notes
    if blocked:
        return "G5", None, notes
    return "G4", None, notes
