"""The ruler harness must reproduce the numbers it is built to defend.

Two arms, and they check different things. **Fidelity**
(`--min-speech-ms 0`) is the harness's own credibility: the scratch
`sim.py`/`viyt.py` port already measured these numbers directly against
`rulers.pkl`, so if `run_attribution_rulers.py` — which drives the real shipped
TypeScript reducer instead — disagrees with them by more than float rounding,
the harness is wrong and nothing downstream can be trusted. **Gated**
(`--min-speech-ms 300`, the product value) is what the plan's A1 acceptance
number actually is: the 300 ms Silero gate proxy applied, 0.50/0.45.

Only floor-0 and gated-300 cells for `shipped` and `0.50/0.45` are asserted
here, exactly as phase 02 measured them. Phase 06 raises the shipped config
default (`client_pipeline.SHIPPED`) and this file's job then extends to the
full A1 table (ViYT far, old prod, order-perturbation minimum, the
conversation ruler) — not before, because `0.50/0.45` is not shipped yet.
"""

from __future__ import annotations

import os

import pytest

from run_attribution_rulers import CONFIGS, PKL_PATH, SHA256SUMS_PATH, _load_pkl_rulers, score_meeting

#: Set to 1 to turn every skip below into a failure. Same contract as
#: `test_segment_parity.py:52` and `test_attribution_parity.py`: whatever
#: produces the plan's official A1 numbers must set this.
REQUIRE_RULERS = os.environ.get("SPEAKER_BENCH_REQUIRE_RULERS") == "1"

#: Absolute accuracy tolerance. The scratch port and this harness compute the
#: same greedy speech-weighted metric over the same reducer, so the only
#: legitimate drift is float rounding across the two languages — widening this
#: past a single ULP-scale margin is not a fix.
ACCURACY_TOLERANCE = 0.001

#: (ruler, min_speech_ms, config_name) -> (expected accuracy, expected exact count, meetings)
#:
#: Floor-0 rows are the fidelity check (plan.md, phase 02 step 4); the
#: min-speech-ms 300 rows are the gated numbers phase 02's Context table
#: quotes for 0.50/0.45 — the only config this phase can gate-check, since
#: `shipped` (0.375/0.325) is not measured gated in the plan.
EXPECTED = {
    ("viyt/clean", 0.0, "shipped"): (0.910, 90, 100),
    ("viyt/far", 0.0, "shipped"): (0.873, 89, 100),
    ("prod", 0.0, "shipped"): (0.827, 5, 8),
    ("viyt/clean", 0.0, "0.50/0.45"): (0.938, 96, 100),
    ("viyt/far", 0.0, "0.50/0.45"): (0.903, 95, 100),
    ("prod", 0.0, "0.50/0.45"): (0.920, 5, 8),
    ("viyt/clean", 300.0, "0.50/0.45"): (0.945, 96, 100),
    ("viyt/far", 300.0, "0.50/0.45"): (0.910, 95, 100),
    ("prod", 300.0, "0.50/0.45"): (0.921, 7, 8),
}


def _unavailable(reason: str) -> None:
    if REQUIRE_RULERS:
        pytest.fail(
            f"{reason}\nSPEAKER_BENCH_REQUIRE_RULERS=1 is set, so missing ruler "
            "data is a failure rather than a skip."
        )
    pytest.skip(reason)


def _rulers() -> dict[str, list[dict]]:
    if not PKL_PATH.exists() or not SHA256SUMS_PATH.exists():
        _unavailable(f"{PKL_PATH} not restored; see rulers/README.md")
    try:
        return _load_pkl_rulers()
    except RuntimeError as error:
        _unavailable(str(error))


def test_rulers_exist_when_required() -> None:
    """A required run with no ruler data verifies nothing and must say so."""
    if REQUIRE_RULERS and not PKL_PATH.exists():
        pytest.fail(f"SPEAKER_BENCH_REQUIRE_RULERS=1 but {PKL_PATH} is absent")


@pytest.mark.parametrize(
    ("ruler_name", "min_speech_ms", "config_name"),
    sorted(EXPECTED),
    ids=lambda value: f"{value}" if not isinstance(value, str) else value,
)
def test_ruler_reproduces_the_measured_numbers(
    ruler_name: str, min_speech_ms: float, config_name: str
) -> None:
    rulers = _rulers()
    if ruler_name not in rulers:
        _unavailable(f"{ruler_name!r} missing from {PKL_PATH}")

    expected_accuracy, expected_exact, expected_meetings = EXPECTED[
        (ruler_name, min_speech_ms, config_name)
    ]
    meetings = rulers[ruler_name]
    assert len(meetings) == expected_meetings, (
        f"{ruler_name}: {len(meetings)} meetings restored, expected {expected_meetings}"
    )

    config = CONFIGS[config_name]
    accuracies = []
    exact_count = 0
    for meeting in meetings:
        accuracy, is_exact = score_meeting(meeting, config, min_speech_ms)
        accuracies.append(accuracy)
        exact_count += int(is_exact)
    mean_accuracy = sum(accuracies) / len(accuracies)

    assert mean_accuracy == pytest.approx(expected_accuracy, abs=ACCURACY_TOLERANCE), (
        f"{ruler_name} config={config_name} min_speech_ms={min_speech_ms}: "
        f"accuracy {mean_accuracy:.4f} vs expected {expected_accuracy}"
    )
    assert exact_count == expected_exact, (
        f"{ruler_name} config={config_name} min_speech_ms={min_speech_ms}: "
        f"exact {exact_count}/{len(meetings)} vs expected {expected_exact}"
    )
