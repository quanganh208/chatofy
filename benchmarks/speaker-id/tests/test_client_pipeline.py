"""`client_pipeline.run_client_pipeline` must settle turns the way the client does.

This is not a second parity test — `test_attribution_parity.py` already holds
`auto-attribution.ts` to `online.py` turn by turn. What this file checks is the
GLUE around the shipped reducer: that `--pipeline` mode reproduces the client's
settle path (arrival, deferred-mint members, promotion, pending-to-nearest,
carry-forward) rather than a bare fold-every-vector loop. Vectors are small
hand-picked 2-D unit vectors so every expected label follows from arithmetic
in this docstring's neighbourhood, not from a fixture nobody can re-derive.

Same skip contract as `test_attribution_parity.py`: a machine with no
pnpm/node is a skip, and `SPEAKER_BENCH_REQUIRE_RULERS`/`SPEAKER_BENCH_REQUIRE_PARITY`-driven
runs must not quote a skip as green, so `SPEAKER_BENCH_REQUIRE_PARITY=1` turns
every skip below into a failure instead.
"""

from __future__ import annotations

import math
import os
import shutil

import pytest

from speaker_bench.client_pipeline import run_client_pipeline

#: Set to 1 to turn every skip below into a failure. Same contract as
#: `test_attribution_parity.py` and `test_segment_parity.py`.
REQUIRE_PARITY = os.environ.get("SPEAKER_BENCH_REQUIRE_PARITY") == "1"


def _unavailable(reason: str) -> None:
    if REQUIRE_PARITY:
        pytest.fail(
            f"{reason}\nSPEAKER_BENCH_REQUIRE_PARITY=1 is set, so an unverified "
            "pipeline harness is a failure rather than a skip."
        )
    pytest.skip(reason)


def _toolchain_available() -> bool:
    return shutil.which("pnpm") is not None and shutil.which("node") is not None


def _run(vectors, speech_ms, **kwargs) -> list[int | None]:
    if not _toolchain_available():
        _unavailable("pnpm/node not on PATH; cannot transpile the shipped clusterer")
    try:
        return run_client_pipeline(vectors, speech_ms, **kwargs)
    except RuntimeError as error:
        _unavailable(str(error))


#: Two axis-aligned unit vectors, so joins and mints below are decided by a
#: dot product of 0 or 1 rather than a computed angle.
A = [1.0, 0.0]
B = [0.0, 1.0]
#: 50 degrees off each axis: 0.643/0.766 against A/B, both inside a 0.2/0.8
#: dead zone against either — used for the pending-to-nearest case below.
C = [math.cos(math.radians(50)), math.sin(math.radians(50))]


def test_provisional_members_labelled_at_mint() -> None:
    """The turn that corroborates a provisional voice names the one before it too.

    Mirrors `turn-keyed-transcript.ts:788-798`: with `mint_confirmations=2`, turn
    0 opens a provisional voice that names nobody, and turn 1 (an identical
    vector, well above `tau_assign`) is what mints it — carrying turn 0's label
    along at the same moment.
    """
    labels = _run(
        [A, A],
        [1000.0, 1000.0],
        min_speech_ms=0,
        tau_assign=0.8,
        tau_new=0.2,
        k_max=2,
        mint_confirmations=2,
    )
    assert labels[0] is not None and labels[0] == labels[1]


def test_promotion_at_settle() -> None:
    """A provisional voice that never got its second turn still names the one it has.

    One turn, `mint_confirmations=2`: it stays pending through the whole
    meeting. At settle (`turn-keyed-transcript.ts:860-873`) the provisional
    voice promotes because the cap has room, and the pending-to-nearest pass
    then resolves the turn to the voice it is now nearest to — itself.
    """
    labels = _run(
        [A],
        [1000.0],
        min_speech_ms=0,
        tau_assign=0.8,
        tau_new=0.2,
        k_max=2,
        mint_confirmations=2,
    )
    assert labels == [0]


def test_pending_turn_resolves_to_nearest_at_settle() -> None:
    """A dead-zone turn is held, not lost, and settles to its nearest voice.

    `A` and `B` mint two voices a turn apart (`mint_confirmations=1`). `C` scores
    0.643 against `A` and 0.766 against `B` — inside a 0.2/0.8 dead zone against
    either, so it is held pending during arrival and resolved only at settle
    (`turn-keyed-transcript.ts:875-898`), to voice `B`, its nearer of the two.
    """
    labels = _run(
        [A, B, C],
        [1000.0, 1000.0, 1000.0],
        min_speech_ms=0,
        tau_assign=0.8,
        tau_new=0.2,
        k_max=2,
        mint_confirmations=1,
    )
    assert labels[0] == 0
    assert labels[1] == 1
    assert labels[2] == 1  # nearest is B, not A


def test_kmax_cap_assigns_rather_than_mints_a_third_voice() -> None:
    """At the cap, a turn that would have minted a third voice joins the nearest one instead.

    `k_max=2` after `A` and `B` mint. A third turn opposite `A` scores below
    `tau_new` against both, which off-cap would open a new voice — capped, it is
    assigned to its nearest existing voice (`B`, score 0) rather than dropped.
    """
    labels = _run(
        [A, B, [-1.0, 0.0]],
        [1000.0, 1000.0, 1000.0],
        min_speech_ms=0,
        tau_assign=0.8,
        tau_new=0.2,
        k_max=2,
        mint_confirmations=1,
    )
    assert labels[2] is not None  # never silently dropped
    assert len(set(label for label in labels if label is not None)) <= 2  # cap held


def test_gated_turn_inherits_the_previous_label() -> None:
    """A turn under the speech floor is never observed and carries the label before it.

    Turn 1's vector points at a completely different voice from turn 0's, but
    its `speech_ms` is below `min_speech_ms`: `run_client_pipeline` replaces its
    vector with `None` before the node process ever sees it, so it is never
    folded into any centroid and settles by carry-forward instead — the same
    outcome a turn whose embedding never arrived gets in
    `turn-keyed-transcript.ts`'s `fillPendingTurns`.
    """
    labels = _run(
        [A, B, B],
        [1000.0, 100.0, 1000.0],
        min_speech_ms=300.0,
        tau_assign=0.8,
        tau_new=0.2,
        k_max=2,
        mint_confirmations=1,
    )
    assert labels[0] == 0
    assert labels[1] == labels[0]  # gated: carried forward, not observed as B
    assert labels[2] == 1  # observed normally, far from A: mints its own voice
