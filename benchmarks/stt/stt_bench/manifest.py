"""Manifest loading/validation. One JSONL record per test utterance.

Record shape: {"id", "lang", "audio_path", "ref_text", "duration_s"}.
audio_path is relative to the manifest file's directory; audio must already be
16 kHz mono PCM16 WAV (prepare_datasets.py guarantees this).
"""

import json
from dataclasses import dataclass
from pathlib import Path

MIN_DURATION_S = 3.0
MAX_DURATION_S = 10.0
SUPPORTED_LANGS = {"vi", "en"}


@dataclass(frozen=True)
class Utterance:
    id: str
    lang: str
    audio_path: Path  # absolute, resolved against the manifest directory
    ref_text: str
    duration_s: float


def load_manifest(manifest_path: Path) -> list[Utterance]:
    """Load and validate a manifest; raises ValueError on any bad record."""
    manifest_path = Path(manifest_path)
    base_dir = manifest_path.parent
    utterances: list[Utterance] = []
    seen_ids: set[str] = set()

    with open(manifest_path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            utt = Utterance(
                id=record["id"],
                lang=record["lang"],
                audio_path=(base_dir / record["audio_path"]).resolve(),
                ref_text=record["ref_text"],
                duration_s=float(record["duration_s"]),
            )
            if utt.lang not in SUPPORTED_LANGS:
                raise ValueError(f"{manifest_path}:{line_no}: unsupported lang {utt.lang!r}")
            if utt.id in seen_ids:
                raise ValueError(f"{manifest_path}:{line_no}: duplicate id {utt.id!r}")
            if not utt.audio_path.is_file():
                raise ValueError(f"{manifest_path}:{line_no}: missing audio {utt.audio_path}")
            if not utt.ref_text.strip():
                raise ValueError(f"{manifest_path}:{line_no}: empty ref_text")
            if not (MIN_DURATION_S <= utt.duration_s <= MAX_DURATION_S):
                raise ValueError(
                    f"{manifest_path}:{line_no}: duration {utt.duration_s}s outside "
                    f"[{MIN_DURATION_S}, {MAX_DURATION_S}]"
                )
            seen_ids.add(utt.id)
            utterances.append(utt)

    if not utterances:
        raise ValueError(f"{manifest_path}: manifest is empty")
    return utterances
