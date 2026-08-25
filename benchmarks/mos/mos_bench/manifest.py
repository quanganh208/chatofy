"""The clip manifest: what the panel listens to, and which system produced it.

One JSONL row per clip:

    {"clip_id": "vi-012", "system": "sherpa-kokoro-en", "lang": "en",
     "path": "clips/kokoro/vi-012.wav", "text": "..."}

`system` is the only field the panel must never see — every blinding decision in
`session.py` exists to keep it out of the listener's reach.
"""

import json
from dataclasses import dataclass
from pathlib import Path

REQUIRED_FIELDS = ("clip_id", "system", "lang", "path")


@dataclass(frozen=True)
class Clip:
    clip_id: str
    system: str
    lang: str
    path: str
    text: str = ""

    @property
    def stimulus_id(self) -> str:
        """The unique key for one piece of audio.

        `clip_id` names the *material* — the utterance every system is asked to
        render — so it deliberately recurs once per system, and is not unique on
        its own. What a listener actually rates is the pair.
        """
        return f"{self.system}::{self.clip_id}"


def load_clips(manifest_path: Path) -> list[Clip]:
    """Read and validate a clip manifest.

    Rejects a repeated (system, clip_id) pair: the attention check works by
    presenting one piece of audio twice under two item ids, and a manifest that
    already contains it twice would make a genuine repeat indistinguishable from
    a manifest mistake. A repeated `clip_id` across *different* systems is not an
    error — it is the balance the panel depends on.
    """
    clips: list[Clip] = []
    seen: set[str] = set()
    with open(manifest_path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            missing = [f for f in REQUIRED_FIELDS if not row.get(f)]
            if missing:
                raise ValueError(f"{manifest_path}:{line_no} missing field(s): {', '.join(missing)}")
            clip = Clip(
                clip_id=row["clip_id"],
                system=row["system"],
                lang=row["lang"],
                path=row["path"],
                text=row.get("text", ""),
            )
            if clip.stimulus_id in seen:
                raise ValueError(
                    f"{manifest_path}:{line_no} duplicate clip: system {clip.system!r}"
                    f" already has clip_id {clip.clip_id!r}"
                )
            seen.add(clip.stimulus_id)
            clips.append(clip)
    if not clips:
        raise ValueError(f"{manifest_path} contains no clips")
    return clips


def systems(clips: list[Clip]) -> list[str]:
    return sorted({c.system for c in clips})


def assert_balanced(clips: list[Clip]) -> None:
    """Every system must cover the same clip_ids, per language.

    A panel is only within-subjects if each listener hears every system on the
    same material. If one system is missing a clip the others have, its mean is
    computed over easier or harder content than its rivals and the comparison
    stops being about the systems.
    """
    by_lang: dict[str, dict[str, set[str]]] = {}
    for clip in clips:
        by_lang.setdefault(clip.lang, {}).setdefault(clip.system, set()).add(clip.clip_id)
    for lang, per_system in sorted(by_lang.items()):
        reference_system, reference_ids = sorted(per_system.items())[0]
        for system, ids in sorted(per_system.items()):
            if ids != reference_ids:
                only_here = sorted(ids - reference_ids)
                only_there = sorted(reference_ids - ids)
                raise ValueError(
                    f"lang {lang!r} is unbalanced: {system!r} vs {reference_system!r} differ — "
                    f"only in {system!r}: {only_here or '[]'}; "
                    f"only in {reference_system!r}: {only_there or '[]'}"
                )
