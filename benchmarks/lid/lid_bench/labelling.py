"""The human step: turns cut from recordings -> a TSV a person reviews -> manifest rows.

`labels-todo.tsv` is what a prepare script writes: one row per cut turn with a
PROPOSED language and empty review columns. The maintainer copies it to
`labels.tsv`, listens to every turn, and fills `lang` (vi/en/zh/noise),
`codeswitch` (0/1) and `reviewed` (1). `apply_labels.py` refuses any row that
is not reviewed: no automatic label reaches a manifest.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from lid_bench.manifest import LABELS, Turn, bucket_for, opaque_id

COLUMNS = ("key", "audio", "session", "order", "channel", "group", "source", "declared_source", "mono",
           "speech_ms", "proposed_lang", "lang", "codeswitch", "speaker", "reviewed")


@dataclass(frozen=True)
class TodoRow:
    key: str
    audio: str
    session: str
    order: int
    channel: str
    group: str
    source: str
    declared_source: str
    mono: int
    speech_ms: int
    proposed_lang: str


def write_todo(path: Path, rows: list[TodoRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, delimiter="\t")
        writer.writerow(COLUMNS)
        for r in rows:
            writer.writerow([r.key, r.audio, r.session, r.order, r.channel, r.group, r.source, r.declared_source,
                             r.mono, r.speech_ms, r.proposed_lang, "", "", "", "0"])


class LabelError(ValueError):
    pass


def read_labels(path: Path, license: str) -> tuple[list[Turn], int]:
    """Reviewed rows as Turns, and how many rows were left unreviewed."""
    turns, pending = [], 0
    with path.open(encoding="utf-8", newline="") as fh:
        for line_no, row in enumerate(csv.DictReader(fh, delimiter="\t"), start=2):
            if row["reviewed"].strip() != "1":
                pending += 1
                continue
            lang = row["lang"].strip()
            if lang not in LABELS:
                raise LabelError(f"{path}:{line_no}: lang {lang!r} not in {LABELS}")
            codeswitch = row["codeswitch"].strip() or "0"
            if codeswitch not in ("0", "1"):
                raise LabelError(f"{path}:{line_no}: codeswitch must be 0 or 1")
            speech = int(row["speech_ms"])
            # Session ids are hashed too: the recording's own name is a prod
            # conversation id, and manifests are copied into run directories.
            session = opaque_id(row["source"], row["session"])
            turns.append(Turn(
                id=opaque_id(row["source"], row["key"]), audio=row["audio"], lang=lang,
                bucket=bucket_for(speech), speech_ms=speech, channel=row["channel"], group=row["group"],
                source=row["source"], real=True, license=license, session=session, order=int(row["order"]),
                speaker=row["speaker"].strip() or None, codeswitch=codeswitch == "1", noise=lang == "noise",
                declared_source=row["declared_source"].strip() or None, mono=row["mono"].strip() == "1",
            ))
    return turns, pending


@dataclass(frozen=True)
class SessionSpec:
    """One recording and what is known about it before anyone listens."""
    recording: Path
    session: str
    channel: str
    source: str
    declared_source: str = ""
    mono: bool = False
    proposed_lang: str = ""


def cut_to_todo(specs: list[SessionSpec], turns_dir: Path, bench_root: Path) -> list[TodoRow]:
    """Cut every recording with the real gate and propose a row per turn."""
    from lid_bench.cutting import cut_recording
    from lid_bench.sidecar import speech_ms

    rows: list[TodoRow] = []
    for spec in specs:
        stem = opaque_id(spec.source, spec.session)
        group = "phone" if spec.channel == "phone" else f"{spec.source}-{spec.channel}"
        for turn, path, samples in cut_recording(spec.recording, turns_dir, stem):
            rows.append(TodoRow(
                key=f"{spec.session}#{turn.index}", audio=path.relative_to(bench_root).as_posix(),
                session=spec.session, order=turn.index, channel=spec.channel, group=group, source=spec.source,
                declared_source=spec.declared_source, mono=int(spec.mono), speech_ms=speech_ms(samples),
                proposed_lang=spec.proposed_lang,
            ))
        print(f"{spec.source} {stem}: {sum(1 for r in rows if r.session == spec.session)} turns")
    return rows
