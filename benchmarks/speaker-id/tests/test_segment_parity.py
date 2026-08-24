"""The Python speech-gate port must agree with the real TypeScript gate.

This is the test that keeps every downstream number honest. `segment.py` is a
hand port; if it drifts, cut boundaries move, embeddings get computed over
different audio, and the pairwise/session numbers change for a reason nobody
would find. So the port is checked against the genuine article on every run.

The oracle is `scripts/gate-reference.mjs`, which drives the actual
`SpeechGate` from `packages/realtime-client`. It is deliberately NOT
`benchmarks/realtime/vad-reference.mjs` — that file is a different algorithm on
purpose (see its header), so a correct port would legitimately disagree with it
and the tolerance would have to be widened until it proved nothing.

Both sides run the same deterministic algorithm on the same audio, so the
tolerance below is tight. It is fixed here, before any measurement, and must not
be widened to make a failing port pass — a failing port is the finding.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from speaker_bench.io import load_audio
from speaker_bench.segment import run_gate

BENCH_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCH_ROOT.parent.parent
GATE_REFERENCE = BENCH_ROOT / "scripts" / "gate-reference.mjs"
FIXTURES = REPO_ROOT / "benchmarks" / "realtime" / "fixtures"

#: Blocks of disagreement tolerated on any single event.
#:
#: Both implementations are deterministic and share every constant, so the only
#: legitimate source of drift is float rounding in the per-block resample
#: nudging one block across the speech threshold. One block (~21ms) covers that.
#: Widening this is not a fix.
TOLERANCE_BLOCKS = 1


#: Set to 1 to turn every skip below into a failure.
#:
#: Skips exist so a casual `uv run pytest` on a machine without the workspace
#: toolchain is not a wall of red. But "45 passed, 35 skipped" looks very much
#: like "45 passed" at a glance, so a broken port could be quoted as green.
#: Whatever produces official Phase 3/5 numbers must set this, and the run's
#: artifacts should record whether parity actually ran — a measurement whose
#: segmentation was never verified has no provenance.
REQUIRE_PARITY = os.environ.get("SPEAKER_BENCH_REQUIRE_PARITY") == "1"


def _unavailable(reason: str) -> None:
    """Skip, or fail if this run is required to verify parity."""
    if REQUIRE_PARITY:
        pytest.fail(
            f"{reason}\n"
            "SPEAKER_BENCH_REQUIRE_PARITY=1 is set, so an unverified "
            "segmentation port is a failure rather than a skip."
        )
    pytest.skip(reason)


def _fixtures() -> list[Path]:
    if not FIXTURES.is_dir():
        return []
    # Sorted so a failure names the same file on every machine.
    return sorted(FIXTURES.glob("*.wav"))


def _reference(path: Path, max_utterance_ms: float = 0.0) -> dict:
    """Run the real gate over a fixture, or skip if the toolchain is absent."""
    if shutil.which("pnpm") is None:
        _unavailable("pnpm not on PATH; cannot transpile the real SpeechGate")
    if shutil.which("node") is None:
        # Guarded alongside pnpm: otherwise `subprocess.run` raises
        # FileNotFoundError and the test ERRORS in both modes, which contradicts
        # the "a casual run should not be red" intent of the skips.
        _unavailable("node not on PATH; cannot run the gate reference")
    command = ["node", str(GATE_REFERENCE), str(path)]
    if max_utterance_ms:
        command += ["--max-utterance-ms", str(int(max_utterance_ms))]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        _unavailable(f"gate-reference.mjs unavailable: {result.stderr.strip()[:300]}")
    return json.loads(result.stdout)


# NO module-level skip. An earlier version skipped the whole module when the
# fixtures directory was empty, which also skipped `test_parity_on_a_synthetic_clip`
# — the one case that exists precisely so a machine with no fixtures still
# verifies segmentation against the real gate. The parametrized test collects
# zero cases on its own when there are no fixtures, and the two guards below
# cover the rest, so the module-level skip bought nothing and cost the coverage
# it was added to protect.


def test_fixtures_exist_when_parity_is_required() -> None:
    """A required-parity run with no fixtures verifies nothing and must say so."""
    if REQUIRE_PARITY and not _fixtures():
        pytest.fail(f"SPEAKER_BENCH_REQUIRE_PARITY=1 but no fixtures under {FIXTURES}")


#: Gate configurations to check, not just the default one.
#:
#: With no ceiling, `hasCeiling` is false and THREE of the subtlest branches in
#: `speech-gate.ts` never execute: `armIfDue`, its `probableEndFired`
#: suppression, and the armed-cut-before-hangover ordering. A port that
#: mis-ordered the arm relative to the ceiling check would pass a default-only
#: suite and cut every long turn in the wrong place — and Phase 4 runs with a
#: ceiling set.
GATE_CONFIGS = [0.0, 1500.0]


@pytest.mark.parametrize("max_utterance_ms", GATE_CONFIGS, ids=lambda v: f"ceiling{int(v)}")
@pytest.mark.parametrize("fixture", _fixtures(), ids=lambda p: p.stem)
def test_port_matches_real_speech_gate(fixture: Path, max_utterance_ms: float) -> None:
    expected = _reference(fixture, max_utterance_ms)
    audio = load_audio(fixture)
    actual = run_gate(audio.samples, audio.sample_rate, max_utterance_ms=max_utterance_ms)

    # Block framing must match first: if the two disagree about how the audio is
    # chopped, comparing event indices is meaningless and the mismatch below
    # would be reported as a gate difference rather than a framing one.
    assert actual.block_ms == pytest.approx(expected["blockMs"], rel=1e-9), (
        f"block duration differs: {actual.block_ms} vs {expected['blockMs']}"
    )
    assert len(actual.speech_mask) == expected["blocks"], (
        f"block count differs: {len(actual.speech_mask)} vs {expected['blocks']}"
    )

    # The mask, not just its length. It drives net-speech accounting and hence
    # duration buckets; a noise-floor drift can flip borderline blocks without
    # moving any event, so comparing events alone would not see it.
    expected_mask = [bool(value) for value in expected["speechMask"]]
    if actual.speech_mask != expected_mask:
        differing = [
            i for i, (a, b) in enumerate(zip(actual.speech_mask, expected_mask)) if a != b
        ]
        pytest.fail(
            f"{fixture.name}: speech mask differs at {len(differing)} block(s), "
            f"first at {differing[0]} — net-speech and duration buckets would drift"
        )

    expected_events = expected["events"]
    assert len(actual.events) == len(expected_events), (
        f"{fixture.name}: event count differs — "
        f"python {[e.type for e in actual.events]} vs "
        f"reference {[e['type'] for e in expected_events]}"
    )

    for index, (mine, theirs) in enumerate(zip(actual.events, expected_events)):
        assert mine.type == theirs["type"], (
            f"{fixture.name}: event {index} type {mine.type} != {theirs['type']}"
        )
        assert mine.reason == theirs.get("reason"), (
            f"{fixture.name}: event {index} reason {mine.reason} != {theirs.get('reason')}"
        )
        drift = abs(mine.block_index - theirs["blockIndex"])
        assert drift <= TOLERANCE_BLOCKS, (
            f"{fixture.name}: event {index} ({mine.type}) drifted {drift} blocks — "
            f"python block {mine.block_index}, reference block {theirs['blockIndex']}. "
            "Fix the port; do not widen TOLERANCE_BLOCKS."
        )


def test_forced_cut_path_is_modelled() -> None:
    """The length-ceiling path must be ported too, not only the hangover path.

    Continuous capture configures `maxUtteranceMs`, and long fixture turns reach
    it. A port that only models silence-based endings would look correct on
    short clips and diverge exactly where turns are longest.
    """
    fixtures = _fixtures()
    if not fixtures:
        # Without this, `max()` raises ValueError and the run reports an error
        # whose message says nothing about the actual problem.
        _unavailable("no realtime fixtures on disk")
    longest = max(fixtures, key=lambda p: p.stat().st_size)
    audio = load_audio(longest)

    unbounded = run_gate(audio.samples, audio.sample_rate)
    bounded = run_gate(audio.samples, audio.sample_rate, max_utterance_ms=1500)

    forced = [event for event in bounded.events if event.reason == "forced"]
    assert forced, (
        f"{longest.name}: a 1500ms ceiling produced no forced cut — "
        "the ceiling path is not wired up"
    )
    assert len(bounded.events) > len(unbounded.events), (
        "a ceiling should produce more turn boundaries, not fewer"
    )


def test_parity_on_a_synthetic_clip(tmp_path) -> None:
    """One parity case that does not depend on the fixtures directory.

    `benchmarks/realtime/fixtures/` is gitignored and regenerated by a script
    that needs the TTS sidecar running, so a fresh checkout has none. Without
    this case, such a machine reports "2 passed, 35 skipped" in default mode —
    green, having verified nothing whatsoever about segmentation.

    Deterministic (seeded) so a failure is reproducible, and 48 kHz so it runs at
    production's block framing rather than a ratio-1.0 special case.
    """
    import numpy as np
    import soundfile as sf

    rate = 48_000
    rng = np.random.default_rng(20260824)

    def noise(ms: float, level: float) -> np.ndarray:
        return rng.uniform(-level, level, int(rate * ms / 1000.0))

    signal = np.concatenate(
        [
            noise(300, 0.001),   # room tone, so the floor has something to learn
            noise(1200, 0.3),    # speech
            noise(300, 0.001),   # internal pause, shorter than the hangover
            noise(900, 0.3),     # more speech
            noise(900, 0.001),   # enough trailing silence to close the turn
        ]
    )
    clip = tmp_path / "synthetic-48k.wav"
    sf.write(clip, signal.astype(np.float32), rate, subtype="PCM_16")

    expected = _reference(clip)
    audio = load_audio(clip)
    actual = run_gate(audio.samples, audio.sample_rate)

    assert [bool(v) for v in expected["speechMask"]] == actual.speech_mask
    assert len(actual.events) == len(expected["events"])
    for mine, theirs in zip(actual.events, expected["events"]):
        assert mine.type == theirs["type"]
        assert abs(mine.block_index - theirs["blockIndex"]) <= TOLERANCE_BLOCKS

    # The clip is built to close its turn; if it does not, the synthetic case is
    # not exercising turn ending and this test is weaker than it looks.
    assert any(event.type == "end" for event in actual.events), (
        "synthetic clip did not close a turn — it is not covering turn ending"
    )
