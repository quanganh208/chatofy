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

#: ASCII clause and sentence terminators.
SPACED_MARKS = ",;:.!?…"
#: Full-width terminators, as Chinese writes them: no space follows them and
#: none is ever part of a number, so they need no lookahead.
FULL_WIDTH_MARKS = "，。！？；："

#: Clause and sentence terminators, kept with the text they follow. The
#: lookahead on the ASCII marks requires whitespace or end-of-text after the
#: mark, so "3.5" and the Vietnamese decimal comma in "1,5 triệu" are not
#: boundaries. `\Z` rather than `$`: Python's `$` also matches before a
#: trailing newline, JavaScript's (without the m flag) does not.
BOUNDARY = re.compile(rf"[{SPACED_MARKS}]+(?=\s|\Z)|[{FULL_WIDTH_MARKS}]+")


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
            # No space after a full-width mark: Chinese writes none there.
            joiner = "" if previous[-1] in FULL_WIDTH_MARKS else " "
            merged[-1] = f"{previous}{joiner}{part}"
        else:
            merged.append(part)
    return merged


#: A capped head shorter than this is not worth a synthesis call of its own,
#: and a remainder shorter than this would be spoken as a stub after it.
MIN_CAP_PART_CHARS = 8

#: Words a head must not end on: the listener would hear the phrase stop on them.
_DANGLING = frozenset(
    (
        "a an the to of in on at for with my your his her our their its"
        " is are was were be been will would can could has have had"
    ).split()
)
#: Words a cut may fall in front of, where speech already pauses naturally.
_PHRASE_STARTS = frozenset(
    "and but or because that when if so to for with which while after before".split()
)


#: Longest head tried when the capped head would be a single word, so a pair
#: like "Artificial intelligence" stays together.
TWO_WORD_HEAD_MAX_CHARS = 24
#: Floor and growth of each later piece's budget. A piece is synthesized while
#: the one before it plays, so it may grow with that one's length; a fixed
#: second cut left 7 of 71 recorded turns with a gap over 150 ms.
LATER_PIECE_MIN_CHARS = 45
LATER_PIECE_GROWTH = 3


_CURRENCY = "$€£¥₫"


def _word(token: str) -> str:
    """A token as a bare lowercase word, without quotes or trailing punctuation."""
    return token.strip("\"'“”‘’,;:()").lower()


def _cut(clause: str, max_chars: int) -> tuple[str, str] | None:
    """The best word-boundary cut of `clause` with a head of at most `max_chars`."""
    candidates = []
    for match in re.finditer(r" +", clause):
        head, rest = clause[: match.start()], clause[match.end() :]
        if not MIN_CAP_PART_CHARS <= len(head) <= max_chars or len(rest) < MIN_CAP_PART_CHARS:
            continue
        # A currency sign belongs to the number after it: "$ | 150" is a digit cut.
        if head[-1].isdigit() or rest.lstrip(_CURRENCY)[:1].isdigit():
            continue
        if _word(head.split()[-1]) in _DANGLING:
            continue
        candidates.append((head, rest))
    if not candidates:
        return None
    natural = [c for c in candidates if _word(c[1].split(None, 1)[0]) in _PHRASE_STARTS]
    return (natural or candidates)[-1]


def cap_first_clause(parts: list[str], max_chars: int | None) -> list[str]:
    """Cut the first clause into pieces, the first at most `max_chars` long.

    The first clause is synthesized whole before any audio exists, and on Kokoro
    its cost grows with its length: 201 ms + 15 ms per character on production,
    r = 0.96 (docs/development-journey.md, 11/11/2026). A shorter head makes the
    first audio earlier. Each later piece of that clause is synthesized while
    the piece before it plays, so its budget is `LATER_PIECE_GROWTH` times that
    piece's length, never under `LATER_PIECE_MIN_CHARS`; that keeps it ready
    before the previous one ends. Later clauses are left as they are.

    The text is unchanged: the pieces together are exactly the first clause. A
    cut never touches a digit (it would split "20 percent" or "1 000"), never
    leaves a function word ending a piece, and never leaves a piece under
    `MIN_CAP_PART_CHARS`. With no such space the clause stays whole, and so does
    every clause when `max_chars` is None.
    """
    if max_chars is None or not parts or len(parts[0]) <= max_chars:
        return parts
    cut = _cut(parts[0], max_chars)
    if cut is not None and " " not in cut[0]:
        wider = _cut(parts[0], TWO_WORD_HEAD_MAX_CHARS)
        if wider is not None and " " in wider[0]:
            cut = wider
    if cut is None:
        return parts
    pieces = [cut[0]]
    rest = cut[1]
    while True:
        budget = max(LATER_PIECE_MIN_CHARS, LATER_PIECE_GROWTH * len(pieces[-1]))
        nxt = _cut(rest, budget) if len(rest) > budget else None
        if nxt is None:
            pieces.append(rest)
            return [*pieces, *parts[1:]]
        pieces.append(nxt[0])
        rest = nxt[1]
