"""Turn-log handling for the browser-channel recording.

Phase 7 records two WAVs from one microphone at the same moment — production's
DSP chain and a DSP-off control — against a single shared turn log. This module
turns that log into scorable trials.

**The absolute EER from this fixture is not comparable to Checkpoint 1's.** One
session means one room, one microphone, one gain state, and same-speaker pairs
that necessarily share all three; the corpus screen went to considerable trouble
to avoid exactly that. What IS comparable is the **difference** between the two
tracks, because both inherit the same room, the same speakers and the same turn
log, and differ only in the processing. That difference is the whole deliverable,
and every function here exists to keep the two sides matched so the subtraction
is valid.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

#: The rate the recorder writes, matching production's downsample target.
SAMPLE_RATE = 16_000

#: Minimum turns apart for a same-speaker pair.
#:
#: The scan-order rule from `pairs.py` does not transfer: there, distance in the
#: index stood in for "probably a different recording", and here every turn comes
#: from one recording by construction. What this rule can still buy is distance
#: in TIME, so a pair does not share one moment's AGC state or one position in
#: the room. Small, because a 10-minute session holds few turns per speaker and a
#: larger value would leave nothing to pair.
MIN_TURN_GAP = 4


#: What a turn's language field says when the recorder did not collect one.
#:
#: ISO 639-2's "undetermined", not an empty string and not a guess. Logs written
#: before the recorder carried a language selector are still loadable, and they
#: report the absence rather than silently counting as one language or the other.
UNDETERMINED_LANGUAGE = "und"


@dataclass(frozen=True)
class Turn:
    """One prompted turn, addressed by where it sits in the recording."""

    turn_index: int
    speaker_id: str
    distance: str
    start_ms: int
    end_ms: int
    #: Which language was spoken, as the operator labelled it during capture.
    #:
    #: Costs nothing at record time and is the only source for the
    #: cross-language fraction the deferred language-ID path would need. It is
    #: NOT read by the delta: this phase measures a microphone, and a turn's
    #: language does not change what the channel did to it.
    language: str = UNDETERMINED_LANGUAGE

    @property
    def duration_s(self) -> float:
        return (self.end_ms - self.start_ms) / 1000.0


@dataclass(frozen=True)
class ChannelPair:
    """One trial: two turns and whether they share a speaker."""

    same: bool
    a: Turn
    b: Turn
    bucket_s: float

    @property
    def turn_gap(self) -> int:
        return abs(self.a.turn_index - self.b.turn_index)


def load_turn_log(path: Path) -> tuple[dict, list[Turn]]:
    """Read the recorder's JSON sidecar, refusing a log that cannot be scored.

    Every check here is for a failure that would otherwise produce a number
    rather than an error: a control track recorded with processing still on, a
    log whose turns overlap, or one whose ordering does not match its timestamps.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))

    rate = int(payload.get("sampleRate", 0))
    if rate != SAMPLE_RATE:
        raise ValueError(f"turn log reports {rate} Hz, expected {SAMPLE_RATE}")

    reported = payload.get("settingsReported", {})
    processed = reported.get("processed", {})
    control = reported.get("control", {})
    if processed.get("noiseSuppression") is False or control.get("noiseSuppression") is True:
        raise ValueError(
            "the two tracks' reported constraints are the wrong way round or identical; "
            "the control is not a control and the delta would be meaningless"
        )

    turns = [
        Turn(
            turn_index=int(entry["turnIndex"]),
            speaker_id=str(entry["speakerId"]),
            distance=str(entry["distance"]),
            start_ms=int(entry["startMs"]),
            end_ms=int(entry["endMs"]),
            language=str(entry.get("language", UNDETERMINED_LANGUAGE)),
        )
        for entry in payload["turns"]
    ]
    if not turns:
        raise ValueError("turn log holds no turns")

    ordered = sorted(turns, key=lambda turn: turn.turn_index)
    for turn in ordered:
        if turn.end_ms <= turn.start_ms:
            raise ValueError(f"turn {turn.turn_index} ends before it starts")
    for earlier, later in zip(ordered, ordered[1:]):
        if later.start_ms < earlier.end_ms:
            raise ValueError(
                f"turns {earlier.turn_index} and {later.turn_index} overlap in time; "
                "a turn's audio would contain another speaker"
            )
    return payload, ordered


def turn_samples(audio: np.ndarray, turn: Turn, *, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """The samples belonging to one turn.

    Raises rather than returning a short clip when the log runs past the audio:
    a truncated final turn scored as if whole is the kind of thing that shifts
    an EER by a point and shows up nowhere.
    """
    start = int(round(turn.start_ms / 1000 * sample_rate))
    end = int(round(turn.end_ms / 1000 * sample_rate))
    if end > len(audio):
        raise ValueError(
            f"turn {turn.turn_index} ends at sample {end} but the track holds {len(audio)}; "
            "the log and the audio came from different recordings"
        )
    return audio[start:end]


def eligible_turns(turns: list[Turn], bucket_s: float) -> list[Turn]:
    """Turns long enough to fill a bucket without padding."""
    return [turn for turn in turns if turn.duration_s >= bucket_s]


def build_channel_pairs(
    turns: list[Turn],
    bucket_s: float,
    *,
    min_turn_gap: int = MIN_TURN_GAP,
) -> list[ChannelPair]:
    """Every legal same-speaker pair, and every different-speaker pair.

    Enumerated rather than sampled: one session yields few enough turns that
    exhaustive pairing is cheap, and it removes the seed from a number whose
    entire job is to be subtracted from another number. Both sides are scored on
    both tracks, so the delta compares like with like.

    **The two sides are NOT returned in matched counts, deliberately.** An
    earlier docstring here promised "a matched count of different-speaker
    pairs", and the code never did that — it returns every non-target it finds,
    which on a 3-speaker sheet outnumbers the targets several times over. The
    promise was the defect, not the behaviour: EER is a pair of per-class rates
    read where they cross, so class sizes do not bias it, and discarding
    non-targets to reach a matching count would throw away precision on the
    non-target rate for nothing. What unequal counts DO affect is how tight each
    side's estimate is, which is why the caller reports both counts beside every
    EER rather than netting them.

    **`min_turn_gap` applies to targets only**, and that asymmetry is intended.
    The gap exists so a same-speaker pair does not share one moment's AGC state
    or one position in the room — a shared moment makes two clips of one voice
    look artificially alike and flatters the target side. Two DIFFERENT speakers
    sharing a moment are pushed the other way: a shared gain state makes them
    look more alike, which is conservative here, and excluding those pairs would
    drop the hardest non-targets the session produced.
    """
    usable = eligible_turns(turns, bucket_s)
    targets = [
        ChannelPair(same=True, a=a, b=b, bucket_s=bucket_s)
        for index, a in enumerate(usable)
        for b in usable[index + 1 :]
        if a.speaker_id == b.speaker_id
        and abs(b.turn_index - a.turn_index) >= min_turn_gap
    ]
    nontargets = [
        ChannelPair(same=False, a=a, b=b, bucket_s=bucket_s)
        for index, a in enumerate(usable)
        for b in usable[index + 1 :]
        if a.speaker_id != b.speaker_id
    ]
    return targets + nontargets
