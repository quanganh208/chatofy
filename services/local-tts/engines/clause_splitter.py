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


#: A piece shorter than this would be spoken as a stub after the one before.
MIN_CAP_PART_CHARS = 8
#: Shortest head in front of a subordinator ("There are days | when…").
MIN_HEAD_CHARS = 12
#: Shortest head in front of a coordinator or a phrase-level word, where a
#: short head is more often half of one noun phrase ("Many countries | and…").
MIN_COORDINATED_HEAD_CHARS = 15

#: Words a piece must not end on: the listener would hear the phrase stop on
#: them, or they bind to what follows ("so | that", "just | go").
_DANGLING = frozenset(
    (
        "a an the to of in on at for with my your his her our their its"
        " is are was were be been will would can could has have had"
        " so such and but or that just not i you he she we they it me him them us"
    ).split()
)
#: Subordinators: a new clause starts here, so a speaker already pauses.
_SUBORDINATORS = frozenset(
    "because when if while although though since until which who where before after so".split()
)
#: Coordinators: a pause too, unless they join two names or two nouns.
_COORDINATORS = frozenset("and but or".split())
#: Prepositions whose object is a pronoun bind to it: "thinking | to myself".
_PRONOUN_BOUND = frozenset("to for with about from into".split())
_PRONOUNS = frozenset(
    (
        "me you him her us them it myself yourself himself herself itself"
        " ourselves themselves"
    ).split()
)
#: Phrase-level boundary words: natural only after a head of a few words,
#: since "Still secretly thinking | to myself" splits a phrase they belong to.
_PHRASE_STARTS = frozenset("that to for with as than about from into during like".split())
PHRASE_START_MIN_HEAD_WORDS = 3
#: Spelled-out numbers: "twenty | to fifty" is one range, not two phrases.
_NUMBER_WORDS = frozenset(
    (
        "one two three four five six seven eight nine ten eleven twelve thirteen"
        " fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty"
        " fifty sixty seventy eighty ninety hundred thousand million billion"
    ).split()
)

#: Floor and growth of each later piece's budget. A piece is synthesized while
#: the one before it plays, so it may grow with that one's length; a single
#: cut left 7 of 71 recorded turns with a gap over 150 ms.
LATER_PIECE_MIN_CHARS = 45
LATER_PIECE_GROWTH = 3

_CURRENCY = "$€£¥₫"


def _word(token: str) -> str:
    """A token as a bare lowercase word, without quotes or trailing punctuation."""
    return token.strip("\"'“”‘’,;:()").lower()


def _capitalized(token: str) -> bool:
    word = token.strip("\"'“”‘’,;:()")
    return word[:1].isupper() and word not in {"I", "I'm", "I'll", "I've", "I'd"}


def _cut(clause: str, max_chars: int) -> tuple[str, str] | None:
    """The latest grammatical cut of `clause` with a head of at most `max_chars`.

    A cut falls only in front of a boundary word, in tiers: a subordinator
    first, then a coordinator, then a phrase-level word after a head of a few
    words. With no such place the answer is None: there is no fallback to an
    arbitrary space, because a cut inside a phrase ("Principle single |
    origin") sounds like a sentence end.

    Guards keep a boundary word that is not a boundary from cutting: "and"
    between names ("Donald Trump | and Chairman Xi"), a preposition before a
    pronoun ("thinking | to myself"), and "to" in a spelled-out range
    ("twenty | to fifty").
    """
    best: dict[int, tuple[str, str]] = {}
    for match in re.finditer(r" +", clause):
        head, rest = clause[: match.start()], clause[match.end() :]
        if not MIN_HEAD_CHARS <= len(head) <= max_chars or len(rest) < MIN_CAP_PART_CHARS:
            continue
        # A currency sign belongs to the number after it: "$ | 150" is a digit cut.
        if head[-1].isdigit() or rest.lstrip(_CURRENCY)[:1].isdigit():
            continue
        head_words, rest_words = head.split(), rest.split()
        last, following = _word(head_words[-1]), _word(rest_words[0])
        if last in _DANGLING:
            continue
        after = rest_words[1] if len(rest_words) > 1 else ""
        if following in _SUBORDINATORS:
            best[0] = (head, rest)
        elif len(head) < MIN_COORDINATED_HEAD_CHARS:
            continue
        elif following in _COORDINATORS:
            names = (len(head_words) > 1 and _capitalized(head_words[-1])) or _capitalized(after)
            if not names:
                best[1] = (head, rest)
        elif following in _PHRASE_STARTS and len(head_words) >= PHRASE_START_MIN_HEAD_WORDS:
            if following == "to" and last in _NUMBER_WORDS:
                continue
            if following in _PRONOUN_BOUND and _word(after) in _PRONOUNS:
                continue
            best[2] = (head, rest)
    for tier in (0, 1, 2):
        if tier in best:
            return best[tier]
    return None


def cap_first_clause(parts: list[str], max_chars: int | None) -> list[str]:
    """Cut the first clause into pieces at grammatical boundaries.

    The first clause is synthesized whole before any audio exists, and on Kokoro
    its cost grows with its length: 201 ms + 15 ms per character on production,
    r = 0.96 (docs/development-journey.md, 11/11/2026). A shorter head makes the
    first audio earlier. The head is at most `max_chars`; each later piece of
    that clause is synthesized while the one before it plays, so its budget is
    `LATER_PIECE_GROWTH` times that piece's length, never under
    `LATER_PIECE_MIN_CHARS`. Later clauses are left as they are.

    Cuts fall only where a speaker would pause (see `_cut`), so a clause with no
    such place stays whole: slower first audio, but no phrase broken in two. The
    text is unchanged: the pieces together are exactly the first clause. Every
    clause stays whole when `max_chars` is None.
    """
    if max_chars is None or not parts or len(parts[0]) <= max_chars:
        return parts
    cut = _cut(parts[0], max_chars)
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
