"""Streaming access to the VoxVietnam test split.

The split is 38 parquet shards, 4.3GB, with audio stored inline as a float array
per row. Reading it eagerly would put the whole corpus on the heap, so every
access here streams row groups and yields one utterance at a time.

**What the corpus does NOT carry, and why it shapes everything downstream.** The
schema is exactly `{audio: {array, sampling_rate}, speaker: string}`. There is no
video id, no session id, no recording date, no distance label. So a pair of
utterances from one speaker may well come from a single source video, sharing
microphone, room, codec and AGC state.

That is the precise failure the plan warns about: same-speaker similarity
inflated by shared channel rather than shared identity, producing an optimistic
EER and a gate that passes a model which will fail in the room. With no session
metadata the rule cannot simply be enforced, so `index_gap` below exists to make
the risk measurable instead of invisible.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np

#: Where `fetch_corpora.py` puts the VoxVietnam test shards.
DEFAULT_CORPUS_DIR = Path(__file__).resolve().parent.parent / "corpora" / "voxvietnam"

#: Sample rate every clip in the split carries. Verified over all 26,523 rows,
#: not assumed: `load_index` raises if a clip disagrees, because a stray rate
#: would silently change every duration and therefore every duration bucket.
EXPECTED_SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Utterance:
    """One corpus row, addressed by where it sits rather than by a filename.

    ``shard`` and ``row`` together form a stable address inside the split, and
    ``order`` is the position in a global scan. Order matters: it is the only
    proxy available for "these two clips probably came from the same source
    recording", since the corpus ships no session id.
    """

    speaker: str
    shard: int
    row: int
    order: int
    duration_s: float


def shard_paths(corpus_dir: Path = DEFAULT_CORPUS_DIR) -> list[Path]:
    """The test shards, in a stable order."""
    data = Path(corpus_dir) / "data"
    paths = sorted(data.glob("test-*.parquet"))
    if not paths:
        raise FileNotFoundError(
            f"no test shards under {data}. Run scripts/fetch_corpora.py first — "
            "it needs a HuggingFace token for a gated dataset."
        )
    return paths


def iter_rows(
    corpus_dir: Path = DEFAULT_CORPUS_DIR,
    *,
    batch_size: int = 64,
    with_audio: bool = True,
) -> Iterator[tuple[Utterance, np.ndarray | None]]:
    """Stream the split, yielding (utterance, samples).

    ``with_audio=False`` reads only the speaker column, which is dramatically
    faster and is what index construction uses when it does not need the audio.
    """
    import pyarrow.parquet as pq

    columns = ["audio", "speaker"] if with_audio else ["speaker"]
    order = 0
    for shard_index, path in enumerate(shard_paths(corpus_dir)):
        parquet = pq.ParquetFile(path)
        row = 0
        for batch in parquet.iter_batches(batch_size=batch_size, columns=columns):
            for record in batch.to_pylist():
                if with_audio:
                    audio = record["audio"]
                    rate = int(audio["sampling_rate"])
                    if rate != EXPECTED_SAMPLE_RATE:
                        raise ValueError(
                            f"{path.name} row {row}: sample rate {rate}, expected "
                            f"{EXPECTED_SAMPLE_RATE} — every duration bucket depends on this"
                        )
                    samples = np.asarray(audio["array"], dtype=np.float32)
                    duration = len(samples) / rate
                else:
                    samples = None
                    duration = float("nan")
                yield (
                    Utterance(
                        speaker=str(record["speaker"]),
                        shard=shard_index,
                        row=row,
                        order=order,
                        duration_s=duration,
                    ),
                    samples,
                )
                row += 1
                order += 1


INDEX_FIELDS = ("speaker", "shard", "row", "order", "duration_s")


def build_index(corpus_dir: Path = DEFAULT_CORPUS_DIR, *, out: Path) -> list[Utterance]:
    """Scan the split once and cache speaker/duration/address per utterance.

    Scanning 4.3GB takes minutes because the audio column must be decoded to get
    a duration. Every later run reads this CSV instead, so the cost is paid once
    rather than per experiment.
    """
    utterances = [utterance for utterance, _ in iter_rows(corpus_dir, with_audio=True)]
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(INDEX_FIELDS))
        writer.writeheader()
        for utterance in utterances:
            writer.writerow(
                {
                    "speaker": utterance.speaker,
                    "shard": utterance.shard,
                    "row": utterance.row,
                    "order": utterance.order,
                    "duration_s": f"{utterance.duration_s:.4f}",
                }
            )
    return utterances


def load_index(path: Path) -> list[Utterance]:
    """Read a cached index, refusing a truncated one."""
    path = Path(path)
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"{path}: empty index")
    utterances = [
        Utterance(
            speaker=row["speaker"],
            shard=int(row["shard"]),
            row=int(row["row"]),
            order=int(row["order"]),
            duration_s=float(row["duration_s"]),
        )
        for row in rows
    ]
    orders = [utterance.order for utterance in utterances]
    if orders != sorted(orders) or orders[0] != 0 or orders[-1] != len(orders) - 1:
        raise ValueError(
            f"{path}: index order is not a complete 0..N-1 run — the scan was "
            "interrupted, and sampling from it would silently skip utterances"
        )
    return utterances


def index_gap(a: Utterance, b: Utterance) -> int:
    """Distance between two utterances in scan order.

    The **only** available proxy for "different source recording". The corpus
    carries no session id, but it was assembled per speaker per source, so
    neighbouring rows are far more likely to share a video than distant ones.

    A proxy is not a guarantee, and this one is worth exactly as much as the
    measurement that calibrates it — see `scripts/probe_channel_leakage.py`,
    which tests whether same-speaker similarity actually falls with this gap. If
    it does not, the proxy is worthless and the caveat has to be reported rather
    than mitigated.
    """
    return abs(a.order - b.order)


def read_audio(
    wanted: Sequence[Utterance], corpus_dir: Path = DEFAULT_CORPUS_DIR
) -> dict[int, np.ndarray]:
    """Fetch audio for specific utterances in a single streaming pass.

    Keyed by ``order``. Reading one utterance at a time would re-open and
    re-decode a shard per lookup; this walks the split once and keeps only what
    was asked for.
    """
    targets = {utterance.order for utterance in wanted}
    if not targets:
        return {}
    out: dict[int, np.ndarray] = {}
    highest = max(targets)
    for utterance, samples in iter_rows(corpus_dir, with_audio=True):
        if utterance.order in targets:
            assert samples is not None
            out[utterance.order] = samples
        if utterance.order >= highest:
            break
    missing = targets - out.keys()
    if missing:
        raise ValueError(f"{len(missing)} requested utterance(s) not found in the corpus")
    return out


__all__ = [
    "DEFAULT_CORPUS_DIR",
    "EXPECTED_SAMPLE_RATE",
    "INDEX_FIELDS",
    "Utterance",
    "build_index",
    "index_gap",
    "iter_rows",
    "load_index",
    "read_audio",
    "shard_paths",
]
