"""Clause-level synthesis units, for an engine that can only stream per sentence.

A port of `apps/api/src/modules/translate/audio/clause-splitter.ts`, which is
the source of truth: its header carries the measurements that justify splitting
at all, and `clause-splitter.cases.json` beside it is the fixture both
implementations are tested against (`test_clause_splitter.py` here).

It lives in the sidecar now because the stream endpoint takes a whole turn and
lets each engine decide how to cut it. VieNeu streams frames and needs no
splitting; Kokoro, through sherpa-onnx, produces audio one sentence at a time,
so without this a one-sentence turn would stream as one chunk and gain nothing.

Lengths are counted in code points where the TypeScript counts UTF-16 units.
They differ only outside the Basic Multilingual Plane (emoji), which a fragment
floor of four characters does not care about.
"""
import re

#: Shortest part worth its own synthesis call. See the TypeScript original.
MIN_PART_CHARS = 4

#: Clause and sentence terminators, kept with the text they follow. The
#: lookahead requires whitespace or end-of-text after the mark, so "3.5" and
#: the Vietnamese decimal comma in "1,5 triệu" are not boundaries. `\Z` rather
#: than `$`: Python's `$` also matches before a trailing newline, JavaScript's
#: (without the m flag) does not.
BOUNDARY = re.compile(r"[,;:.!?…]+(?=\s|\Z)")


def split_into_clauses(text: str) -> list[str]:
    """Break text into clause-level synthesis units.

    One part when the text has no usable boundary; an empty list for blank input.
    """
    trimmed = text.strip()
    if not trimmed:
        return []

    parts = []
    start = 0
    for match in BOUNDARY.finditer(trimmed):
        part = trimmed[start : match.end()].strip()
        if part:
            parts.append(part)
        start = match.end()

    tail = trimmed[start:].strip()
    if tail:
        parts.append(tail)

    return _absorb_fragments(parts)


def _absorb_fragments(parts: list[str]) -> list[str]:
    """Fold parts too short to stand on their own into their neighbour."""
    merged: list[str] = []
    for part in parts:
        previous = merged[-1] if merged else None
        too_short = len(part) < MIN_PART_CHARS
        previous_too_short = previous is not None and len(previous) < MIN_PART_CHARS
        if previous is not None and (too_short or previous_too_short):
            merged[-1] = f"{previous} {part}"
        else:
            merged.append(part)
    return merged
