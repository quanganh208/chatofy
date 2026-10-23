"""One labelled turn, and the JSONL file a corpus of them lives in.

Every arm reads the same manifest and every criterion is scored from it, so the
schema is the contract the whole bake-off rests on. It is validated on load
rather than trusted: a row with a language outside the label set, or a real turn
with no channel, would silently drop out of (or into) a criterion's denominator.

Ids are opaque on purpose. A prod turn's natural id is a conversation id plus an
ordinal, and the scores files that carry these ids are tracked in git; hashing
keeps them joinable without making them identifying (see `opaque_id`).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path

#: Languages a turn can be identified as. Matches the sidecar's engines.
LANGUAGES = ("vi", "en", "zh")

#: A turn's label: a language, or `noise` for a turn with no speech in it.
LABELS = LANGUAGES + ("noise",)

#: Speech-after-VAD buckets the criteria are stated in (plan.md "Thước đo").
#: Upper bounds in ms; a turn at exactly a bound belongs to the bucket above it.
BUCKETS = (("<1.5", 1500), ("1.5-3", 3000), ("3-8", None))


def bucket_for(speech_ms: int) -> str:
    """The bucket a turn with `speech_ms` of speech falls in.

    Turns are cut at the client's 8 s ceiling, so anything longer is a turn the
    cutter would have split; it is counted in the top bucket rather than dropped.
    """
    for name, upper in BUCKETS:
        if upper is None or speech_ms < upper:
            return name
    raise AssertionError("unreachable: the last bucket has no upper bound")


def opaque_id(*parts: str) -> str:
    """A stable 16-hex id for a turn, derived from whatever names it locally.

    Truncated sha256: enough to join scores to the manifest across a few
    thousand turns without collision, short enough to read in a table, and not
    reversible to the conversation id it was made from.
    """
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Turn:
    id: str
    #: Path to a 16 kHz mono PCM16 WAV, relative to the bench root.
    audio: str
    lang: str
    bucket: str
    speech_ms: int
    #: How the audio reached the microphone: `read` for studio corpora,
    #: `laptop`, `phone`, `speaker` for real capture.
    channel: str
    #: Cross-validation group. Thresholds are chosen with a group held out, so a
    #: group must be a unit that could fail together: one corpus, or one capture
    #: channel of the real data.
    group: str
    #: Dataset the turn came from (fleurs, cv, l2arctic, esc50, prod, recorded).
    source: str
    #: True for conversational speech captured through the product's own path or
    #: a real microphone; False for public read speech.
    real: bool
    license: str
    session: str | None = None
    #: Order the turn was OPENED in within its session. The fallback's "previous
    #: turn" is the predecessor in this order, as the API sees it.
    order: int | None = None
    #: The speaker label a human gave the turn. Used only to judge the simulated
    #: client labels, never by an arm.
    speaker: str | None = None
    codeswitch: bool = False
    noise: bool = False
    #: Speaker's first language for accented speech (L2-ARCTIC), else None.
    accent_l1: str | None = None
    #: The language the session declared as its source, when the recording came
    #: from a session that had one (prod). None for clips with no session.
    declared_source: str | None = None
    #: A session where one person speaks one language throughout (A9-mono).
    mono: bool = False

    def validate(self) -> None:
        if self.lang not in LABELS:
            raise ValueError(f"{self.id}: lang {self.lang!r} not in {LABELS}")
        if self.noise != (self.lang == "noise"):
            raise ValueError(f"{self.id}: noise flag and lang {self.lang!r} disagree")
        if self.bucket != bucket_for(self.speech_ms):
            raise ValueError(f"{self.id}: bucket {self.bucket} does not match {self.speech_ms} ms")
        if not self.channel or not self.group or not self.source:
            raise ValueError(f"{self.id}: channel, group and source are required")
        if (self.session is None) != (self.order is None):
            raise ValueError(f"{self.id}: session and order go together")
        if self.declared_source is not None and self.declared_source not in LANGUAGES:
            raise ValueError(f"{self.id}: declared_source {self.declared_source!r} not a language")


_FIELDS = {f.name for f in fields(Turn)}


def load(path: Path) -> list[Turn]:
    """Read and validate a manifest; ids must be unique."""
    turns: list[Turn] = []
    seen: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        raw = json.loads(line)
        unknown = set(raw) - _FIELDS
        if unknown:
            raise ValueError(f"{path}:{line_no}: unknown fields {sorted(unknown)}")
        turn = Turn(**raw)
        turn.validate()
        if turn.id in seen:
            raise ValueError(f"{path}:{line_no}: duplicate id {turn.id}")
        seen.add(turn.id)
        turns.append(turn)
    return turns


def save(path: Path, turns: list[Turn]) -> None:
    for turn in turns:
        turn.validate()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as out:
        for turn in turns:
            out.write(json.dumps(asdict(turn), ensure_ascii=False) + "\n")
