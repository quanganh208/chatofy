"""The shipped TypeScript clusterer must agree with the Python one.

`packages/realtime-client/src/state/auto-attribution.ts` is a hand port of
`speaker_bench/online.py`. Every threshold the client ships — `tauAssign`,
`tauNew`, `kMax` — was calibrated against the Python implementation on held-out
speakers. If the two drift, the product runs an algorithm nobody has measured
while still quoting the measurements, which is the worst of both: the numbers
look calibrated and describe something else.

**The direction is the opposite of `test_segment_parity.py`.** There, production
came first and Python is the port. Here Python came first and the TypeScript is
the port, so `OnlineAttributor` is the oracle and `scripts/attribution-reference.mjs`
drives the shipped code to be checked.

Both sides run the same deterministic algorithm, so the tolerance below is tight.
It is fixed here, before any measurement, and must not be widened to make a
failing port pass — a failing port is the finding.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest

from speaker_bench.online import OnlineAttributor

BENCH_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCH_ROOT.parent.parent
REFERENCE = BENCH_ROOT / "scripts" / "attribution-reference.mjs"

#: The configuration the client actually ships, from `auto-attribution.ts`.
#: Hardcoded rather than parsed out of the TypeScript: a test that read the
#: constants from the file under test would pass no matter what they became.
TAU_ASSIGN = 0.375
TAU_NEW = 0.325
K_MAX = 2

#: CAM++ embedding width, so the vectors exercise the real arithmetic length.
DIM = 192

#: Absolute score disagreement tolerated per turn.
#:
#: The one legitimate source of drift: `_Cluster` accumulates in float32
#: (`online.py`), JavaScript numbers are float64. Over a few hundred folds of a
#: unit vector that is a relative error near 1e-7, so a cosine can differ in the
#: sixth decimal. Widening this is not a fix.
SCORE_TOLERANCE = 1e-5

#: Scores nearer than this to either bar are excluded from the fixture.
#:
#: Not a weakening of the test — a protection of it. A vector sitting 1e-9 from
#: `tau_assign` would flip branches on float32-vs-float64 rounding alone, and the
#: failure would say "the port is broken" when the truth is "the fixture asked a
#: question neither implementation claims to answer the same way". The branch
#: boundaries are covered by the TypeScript unit tests, which control the cosines
#: exactly.
BAR_MARGIN = 1e-3

#: Set to 1 to turn every skip below into a failure. Same contract as
#: `test_segment_parity.py`: whatever produces official numbers must set it, so
#: an unverified port cannot be quoted as green.
REQUIRE_PARITY = os.environ.get("SPEAKER_BENCH_REQUIRE_PARITY") == "1"


def _unavailable(reason: str) -> None:
    if REQUIRE_PARITY:
        pytest.fail(
            f"{reason}\n"
            "SPEAKER_BENCH_REQUIRE_PARITY=1 is set, so an unverified "
            "attribution port is a failure rather than a skip."
        )
    pytest.skip(reason)


def _unit(rng: np.random.Generator) -> np.ndarray:
    vector = rng.normal(size=DIM).astype(np.float32)
    return vector / np.linalg.norm(vector)


def _voices(rng: np.random.Generator, count: int) -> list[np.ndarray]:
    return [_unit(rng) for _ in range(count)]


def _near(voice: np.ndarray, rng: np.random.Generator, spread: float) -> np.ndarray:
    """A turn from a known voice: the voice plus noise, renormalised.

    ``spread`` is what makes a fixture cover both branches — small keeps turns
    inside `tau_assign`, large pushes them under `tau_new` and mints speakers.
    """
    vector = voice + rng.normal(size=DIM).astype(np.float32) * spread
    return vector / np.linalg.norm(vector)


def _session(seed: int, speakers: int, turns: int, spread: float) -> list[list[float]]:
    """A conversation: `speakers` voices taking `turns` between them."""
    rng = np.random.default_rng(seed)
    voices = _voices(rng, speakers)
    return [
        [float(value) for value in _near(voices[index % speakers], rng, spread)]
        for index in range(turns)
    ]


def _python(vectors: list[list[float]]) -> list[dict]:
    """What the oracle does with the same input."""
    attributor = OnlineAttributor(
        tau_assign=TAU_ASSIGN, tau_new=TAU_NEW, k_max=K_MAX, above_cap="assign"
    )
    out = []
    for vector in vectors:
        assignment = attributor.observe(np.asarray(vector, dtype=np.float32))
        out.append({"index": assignment.label, "created": assignment.created,
                    "score": assignment.score})
    return out


def _typescript(vectors: list[list[float]]) -> dict:
    """Drive the shipped clusterer, or skip if the toolchain is absent."""
    if shutil.which("pnpm") is None:
        _unavailable("pnpm not on PATH; cannot transpile the shipped clusterer")
    if shutil.which("node") is None:
        _unavailable("node not on PATH; cannot run the attribution reference")

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(
            {"tauAssign": TAU_ASSIGN, "tauNew": TAU_NEW, "kMax": K_MAX, "vectors": vectors},
            handle,
        )
        path = handle.name
    try:
        result = subprocess.run(
            ["node", str(REFERENCE), path],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
    finally:
        Path(path).unlink(missing_ok=True)
    if result.returncode != 0:
        _unavailable(f"attribution-reference.mjs unavailable: {result.stderr.strip()[:300]}")
    # `-Infinity` crosses as a string, because JSON has no encoding for it and
    # `JSON.stringify` would otherwise write `null` — see the replacer in the
    # reference script.
    return json.loads(result.stdout, parse_constant=float)


def _score(raw: object) -> float:
    """The reference's score field, with the non-finite sentinel decoded."""
    return float(raw) if not isinstance(raw, str) else float(raw)


@pytest.mark.parametrize(
    ("name", "speakers", "turns", "spread"),
    [
        # Two well-separated voices: the case the product is designed for, and
        # the one every shipped threshold was calibrated on.
        ("two-voices-clean", 2, 40, 0.6),
        # Tighter voices, so turns land in the dead zone and both sides must
        # agree about placing nothing.
        ("two-voices-confusable", 2, 40, 1.6),
        # A third speaker under a cap of two: the above-cap `assign` branch,
        # which is the one the plan chose deliberately and the one a port is
        # most likely to get wrong, because it looks like a no-op.
        ("three-voices-over-cap", 3, 60, 0.9),
        # One voice only: nothing should ever mint a second.
        ("one-voice", 1, 30, 0.5),
    ],
)
def test_port_matches_the_python_attributor(
    name: str, speakers: int, turns: int, spread: float
) -> None:
    vectors = _session(seed=abs(hash(name)) % (2**32), speakers=speakers, turns=turns,
                       spread=spread)
    oracle = _python(vectors)
    actual = _typescript(vectors)

    assert len(actual["assignments"]) == len(oracle), f"{name}: turn count differs"

    compared = 0
    for position, (expected, got) in enumerate(zip(oracle, actual["assignments"])):
        near_a_bar = (
            abs(expected["score"] - TAU_ASSIGN) <= BAR_MARGIN
            or abs(expected["score"] - TAU_NEW) <= BAR_MARGIN
        )
        got_score = _score(got["score"])
        if expected["score"] == float("-inf"):
            # The bootstrap sentinel. Compared exactly rather than approximately:
            # a port that returned a real cosine here would be claiming evidence
            # it did not have, and `approx` against -inf cannot see that.
            assert got_score == float("-inf"), (
                f"{name} turn {position}: score {got_score}, oracle says -inf"
            )
        else:
            assert got_score == pytest.approx(expected["score"], abs=SCORE_TOLERANCE), (
                f"{name} turn {position}: score {got_score} vs {expected['score']}"
            )
        if near_a_bar:
            continue
        compared += 1
        assert got["index"] == expected["index"], (
            f"{name} turn {position}: placed {got['index']}, oracle says {expected['index']}"
        )
        assert got["created"] == expected["created"], (
            f"{name} turn {position}: created={got['created']}, oracle says "
            f"{expected['created']}"
        )

    # A fixture that excluded everything would pass while comparing nothing.
    assert compared > turns * 0.8, f"{name}: only {compared}/{turns} turns were comparable"


def test_the_two_agree_on_how_many_speakers_exist() -> None:
    """The count is what the chip row renders, so a drift here is visible.

    Checked separately from the per-turn labels because a port can place every
    turn on the right cluster and still mint a different number of them — the
    cap branch is exactly where that happens.
    """
    vectors = _session(seed=20260901, speakers=3, turns=60, spread=0.9)
    attributor = OnlineAttributor(
        tau_assign=TAU_ASSIGN, tau_new=TAU_NEW, k_max=K_MAX, above_cap="assign"
    )
    for vector in vectors:
        attributor.observe(np.asarray(vector, dtype=np.float32))

    actual = _typescript(vectors)

    assert actual["clusters"] == attributor.speakers
    assert actual["clusters"] <= K_MAX


def test_the_two_fold_the_same_turns_into_each_centroid() -> None:
    """Turn counts per cluster, which per-turn labels alone do not prove.

    A port that returns the right label while folding a dead-zone turn into a
    centroid would agree on every assignment above and then drift, because the
    profile it compares the NEXT turn against is no longer the same one.
    """
    vectors = _session(seed=20260902, speakers=2, turns=50, spread=1.6)
    attributor = OnlineAttributor(
        tau_assign=TAU_ASSIGN, tau_new=TAU_NEW, k_max=K_MAX, above_cap="assign"
    )
    for vector in vectors:
        attributor.observe(np.asarray(vector, dtype=np.float32))

    actual = _typescript(vectors)

    # Reaching into `_clusters` on purpose: the turn count per cluster has no
    # public accessor, and inventing one on the module under test so a test
    # could read it would be the test shaping the code it checks.
    assert actual["turns"] == [cluster.turns for cluster in attributor._clusters]
