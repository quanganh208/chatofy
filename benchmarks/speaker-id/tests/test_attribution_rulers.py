"""The ruler harness must reproduce the numbers it is built to defend.

Two arms, and they check different things. **Fidelity**
(`--min-speech-ms 0`) is the harness's own credibility: the scratch
`sim.py`/`viyt.py` port already measured these numbers directly against
`rulers.pkl`, so if `run_attribution_rulers.py` — which drives the real shipped
TypeScript reducer instead — disagrees with them by more than float rounding,
the harness is wrong and nothing downstream can be trusted. **Gated**
(`--min-speech-ms 300`, the product value) is what the plan's A1 acceptance
number actually is: the 300 ms Silero gate proxy applied, 0.50/0.45.

Floor-0 and gated-300 cells for `shipped` and `0.50/0.45` are asserted first,
exactly as phase 02 measured them (`shipped` now equals `0.50/0.45`, so those
two configs' gated rows agree by construction). The conversation ruler —
`rulers/conversations/ruler.json`, built by phase 04 from the five real webms —
is asserted separately below: it is one meeting per conversation rather than a
pool of meetings, so it is checked by predicted-cluster count, not by
accuracy/exact-count-over-many-meetings.
"""

from __future__ import annotations

import os

import pytest

from run_attribution_rulers import (
    CONFIGS,
    CONVERSATION_RULER_PATH,
    PKL_PATH,
    SHA256SUMS_PATH,
    _load_conversation_ruler,
    _load_pkl_rulers,
    score_meeting,
)
from speaker_bench.client_pipeline import run_client_pipeline

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
#: Floor-0 rows are the fidelity check (plan.md, phase 02 step 4); min-speech-ms
#: 300 is the product's real gate. `shipped` (`client_pipeline.SHIPPED`) is now
#: 0.50/0.45, the same values `"0.50/0.45"` names literally — both configs are
#: asserted at both floors so a change to either dict alone, without the other,
#: fails here instead of drifting silently.
EXPECTED = {
    ("viyt/clean", 0.0, "shipped"): (0.938, 96, 100),
    ("viyt/far", 0.0, "shipped"): (0.903, 95, 100),
    ("prod", 0.0, "shipped"): (0.920, 5, 8),
    ("viyt/clean", 0.0, "0.50/0.45"): (0.938, 96, 100),
    ("viyt/far", 0.0, "0.50/0.45"): (0.903, 95, 100),
    ("prod", 0.0, "0.50/0.45"): (0.920, 5, 8),
    ("viyt/clean", 300.0, "shipped"): (0.945, 96, 100),
    ("viyt/far", 300.0, "shipped"): (0.910, 95, 100),
    ("prod", 300.0, "shipped"): (0.921, 7, 8),
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


# --- the conversation ruler: one real recording per meeting -----------------
#
# `5b679761` and `74410b70` have three real voices and are excluded from
# tuning (plan.md, Context) — kMax is 2, so neither can score exact under any
# config, and asserting against them would just restate that exclusion as a
# test. Only the two-voice and the two single-voice recordings are checked.

#: The A1 gate: the sidecar's real 300ms Silero floor, the shipped bars.
GATE_MIN_SPEECH_MS = 300.0

TWO_VOICE_CONVERSATION = "conversations/2499c493-7609-42e5-b21e-fa82ae1b4b9f"
SINGLE_VOICE_CONVERSATIONS = (
    "conversations/2bed5c89-6ef4-4ee6-a559-79f3db4c3e2c",
    "conversations/1cd04a39-17d7-40cc-acb1-4db591fc6777",
)


def _conversation_rulers() -> dict[str, list[dict]]:
    if not CONVERSATION_RULER_PATH.exists():
        _unavailable(f"{CONVERSATION_RULER_PATH} not built; see phase 04")
    return _load_conversation_ruler()


def test_two_voice_conversation_scores_exact_at_the_gate() -> None:
    """`2499c493`: two real voices, gated at 300ms. A1 requires acc == 1.000."""
    rulers = _conversation_rulers()
    if TWO_VOICE_CONVERSATION not in rulers:
        _unavailable(f"{TWO_VOICE_CONVERSATION!r} missing from {CONVERSATION_RULER_PATH}")

    meeting = rulers[TWO_VOICE_CONVERSATION][0]
    accuracy, is_exact = score_meeting(meeting, CONFIGS["0.50/0.45"], GATE_MIN_SPEECH_MS)

    assert accuracy == pytest.approx(1.000, abs=ACCURACY_TOLERANCE), (
        f"{TWO_VOICE_CONVERSATION}: accuracy {accuracy:.4f} vs expected 1.000"
    )
    assert is_exact, f"{TWO_VOICE_CONVERSATION}: not an exact speaker-count match"


@pytest.mark.parametrize("conversation_id", SINGLE_VOICE_CONVERSATIONS)
def test_single_voice_conversation_predicts_one_label(conversation_id: str) -> None:
    """A1: `2bed5c89` and `1cd04a39` each predict exactly one label, gated.

    `1cd04a39` is a known failing cell here, left asserting rather than
    weakened. One 670ms window mid-conversation (truth `noise`, i.e. no
    overlapping Scribe word) carries 442ms of sidecar-measured Silero speech —
    a 66% speech fraction, well past the gate's 300ms floor — and a short
    non-empty decode. Phase 04's noise-clip measurement found the same shape on
    other windows this evidence: real, brief speech (most plausibly cross-talk
    or a backchannel) that Scribe's diarization never attributed a word to, not
    garbage a VAD mistook for speech. The clusterer scores that one window far
    from the conversation's one real voice at both the shipped bars and these
    new ones alike (verified separately, not tuned to match here); with
    `mintConfirmations` never corroborating a second turn like it, the voice
    stays provisional through the whole session and is promoted into its own
    cluster at the end, because `kMax` still has room. This is the gate correctly
    not filtering out real speech, not a clusterer defect — see the phase 06
    report for the full measurement, including the shipped-config comparison
    and why the other four-of-five noise windows that leak the same gate do not
    also mint a phantom.
    """
    rulers = _conversation_rulers()
    if conversation_id not in rulers:
        _unavailable(f"{conversation_id!r} missing from {CONVERSATION_RULER_PATH}")

    meeting = rulers[conversation_id][0]
    labels = run_client_pipeline(
        meeting["vectors"],
        meeting["gate_ms"],
        min_speech_ms=GATE_MIN_SPEECH_MS,
        **CONFIGS["0.50/0.45"],
    )
    distinct = {label for label in labels if label is not None}

    assert len(distinct) == 1, f"{conversation_id}: predicted {len(distinct)} voices, expected 1"
