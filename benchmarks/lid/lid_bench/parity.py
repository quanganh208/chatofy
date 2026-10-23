"""Does the runtime that would ship agree with the reference implementation?

An arm measured through NeMo or transformers is not the arm the sidecar would
run; the sidecar runs ONNX through its pinned onnxruntime with a numpy
frontend. Accuracy is taken from the shipped runtime, and this check is what
licenses calling the two the same model: over the parity clips, the largest
per-language probability difference must stay within `MAX_DELTA`. An arm that
fails is recorded `parity_fail` and is not eligible to win.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Largest tolerated |p_reference - p_runtime| on any clip and language.
MAX_DELTA = 0.02

#: Clips the check runs on (plan: 100).
PARITY_CLIPS = 100


@dataclass(frozen=True)
class ParityReport:
    clips: int
    max_delta: float
    worst_id: str | None
    argmax_disagreements: int

    @property
    def passed(self) -> bool:
        return self.clips >= PARITY_CLIPS and self.max_delta <= MAX_DELTA

    def as_dict(self) -> dict:
        return {
            "clips": self.clips,
            "max_delta": round(self.max_delta, 5),
            "worst_id": self.worst_id,
            "argmax_disagreements": self.argmax_disagreements,
            "passed": self.passed,
        }


def compare(reference: dict[str, dict[str, float]], runtime: dict[str, dict[str, float]]) -> ParityReport:
    """Both map clip id -> {lang: prob}. Only clips present in both count;
    a language missing on one side counts as probability 0 there."""
    shared = sorted(set(reference) & set(runtime))
    worst, worst_id, disagreements = 0.0, None, 0
    for clip in shared:
        ref, run = reference[clip], runtime[clip]
        for lang in set(ref) | set(run):
            delta = abs(ref.get(lang, 0.0) - run.get(lang, 0.0))
            if delta > worst:
                worst, worst_id = delta, clip
        if max(ref, key=ref.get) != max(run, key=run.get):
            disagreements += 1
    return ParityReport(clips=len(shared), max_delta=worst, worst_id=worst_id,
                        argmax_disagreements=disagreements)
