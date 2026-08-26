"""Build a blinded, randomized, within-subjects listening session.

Three things have to hold at once, and each is a separate mechanism here:

*blinding* — the listener must not be able to tell which system made a clip,
including by reading the page source. Audio is therefore copied to opaque
`c-####.wav` names drawn in a seeded shuffle that ignores system and clip id, so
neither the filename nor its numeric neighbours carry a hint.

*randomization* — presentation order is drawn per listener from its own RNG.
A single shared order lets a fatigue or drift effect land on the same system for
everyone, which then reads as a quality difference.

*within-subjects* — every listener rates every system on the same clips, so a
generally harsh or generally generous listener shifts all systems together and
cancels out of the comparison. `manifest.assert_balanced` is what enforces it.

Everything is reproducible from `seed`, and the mapping back to systems lives in
the key file, which the panel never receives.
"""

import random
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .manifest import Clip, assert_balanced

DEFAULT_REPEATS = 2


@dataclass(frozen=True)
class Item:
    """One thing a listener is asked to rate, in presentation order."""

    item_id: str
    blind_id: str
    stimulus_id: str
    clip_id: str
    system: str
    lang: str
    is_repeat: bool


@dataclass
class Session:
    seed: int
    listener_ids: list[str]
    blind_of_stimulus: dict[str, str] = field(default_factory=dict)
    source_of_blind: dict[str, str] = field(default_factory=dict)
    playlists: dict[str, list[Item]] = field(default_factory=dict)

    def key_document(self) -> dict:
        """The unblinding key. Never hand this to a listener."""
        return {
            "seed": self.seed,
            "listener_ids": self.listener_ids,
            "blind_of_stimulus": self.blind_of_stimulus,
            "source_of_blind": self.source_of_blind,
            "playlists": {
                listener: [asdict(item) for item in items]
                for listener, items in self.playlists.items()
            },
        }


def _assign_blind_names(clips: list[Clip], rng: random.Random) -> dict[str, str]:
    """stimulus_id -> opaque audio stem, assigned in a shuffled order.

    Shuffling before numbering is the point: assigning c-0000.. in manifest order
    would make the blind id a thin encoding of the system, since manifests are
    normally grouped by system.
    """
    shuffled = list(clips)
    rng.shuffle(shuffled)
    width = max(4, len(str(len(shuffled))))
    return {clip.stimulus_id: f"c-{index:0{width}d}" for index, clip in enumerate(shuffled)}


def _listener_rng(seed: int, listener_id: str) -> random.Random:
    """A per-listener stream, reproducible from the session seed and the id."""
    return random.Random(f"{seed}:{listener_id}")


def build_session(
    clips: list[Clip],
    listener_ids: list[str],
    seed: int,
    repeats_per_listener: int = DEFAULT_REPEATS,
) -> Session:
    """Assemble per-listener playlists with attention-check repeats folded in.

    `repeats_per_listener` clips are presented a second time. A listener whose
    two ratings of one identical clip disagree sharply was not listening, and
    `aggregate.screen_listeners` uses that to drop them before any MOS is
    computed. The repeats are drawn per listener, so nobody can compare notes
    and work out which items are the check.
    """
    if not listener_ids:
        raise ValueError("a panel needs at least one listener")
    if len(set(listener_ids)) != len(listener_ids):
        raise ValueError("listener_ids must be unique")
    if repeats_per_listener < 0:
        raise ValueError("repeats_per_listener must not be negative")
    if repeats_per_listener > len(clips):
        raise ValueError(
            f"cannot repeat {repeats_per_listener} clips from a pool of {len(clips)}"
        )
    assert_balanced(clips)

    session = Session(seed=seed, listener_ids=list(listener_ids))
    session.blind_of_stimulus = _assign_blind_names(clips, random.Random(seed))
    session.source_of_blind = {
        session.blind_of_stimulus[clip.stimulus_id]: clip.path for clip in clips
    }

    for listener_id in listener_ids:
        rng = _listener_rng(seed, listener_id)
        presented = list(clips) + rng.sample(clips, repeats_per_listener)
        rng.shuffle(presented)
        seen: set[str] = set()
        items: list[Item] = []
        width = max(4, len(str(len(presented))))
        for index, clip in enumerate(presented):
            is_repeat = clip.stimulus_id in seen
            seen.add(clip.stimulus_id)
            items.append(
                Item(
                    item_id=f"i-{index:0{width}d}",
                    blind_id=session.blind_of_stimulus[clip.stimulus_id],
                    stimulus_id=clip.stimulus_id,
                    clip_id=clip.clip_id,
                    system=clip.system,
                    lang=clip.lang,
                    is_repeat=is_repeat,
                )
            )
        session.playlists[listener_id] = items

    return session


def copy_blinded_audio(session: Session, manifest_dir: Path, out_dir: Path) -> int:
    """Copy each source clip to its opaque name under `out_dir`.

    Copied rather than linked: a symlink resolves to a path that names the
    system, which undoes the blinding for any listener who hovers a link.
    """
    import shutil

    out_dir.mkdir(parents=True, exist_ok=True)
    for blind_id, source in sorted(session.source_of_blind.items()):
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = manifest_dir / source_path
        if not source_path.is_file():
            raise FileNotFoundError(f"clip audio not found: {source_path}")
        shutil.copy2(source_path, out_dir / f"{blind_id}{source_path.suffix}")
    return len(session.source_of_blind)
