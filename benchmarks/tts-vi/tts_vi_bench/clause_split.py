"""Port of the app's clause splitter, so the incumbent is timed as it ships.

`apps/api/src/modules/translate/audio/clause-splitter.ts` splits translated text
at clause boundaries *in front of* the engine, purely to cut time-to-first-audio.
Its header records the measured effect: 0.648s -> 0.340s, 0.907s -> 0.393s,
1.061s -> 0.813s.

That makes it load-bearing for this benchmark. The app never waits for a whole
sentence, so timing VieNeu that way would overstate its latency roughly twofold
and hand ZeroTTS a win it did not earn. Clause-split is what ships today, and
producing that number requires the same split the app performs.

It is a baseline here, not the engine's floor. Both engines also stream, and the
streamed arm is measured separately — the comparison this harness reports is
clause-split (what the app waits for now) against streamed (what it could wait
for), on both engines.

Ported rather than shared because the original is TypeScript inside the API and
this is a standalone Python harness. `tests/test_clause_split.py` checks the
cases the original's own comments call out, so a divergence surfaces as a failing
test rather than as a quietly different number.
"""

import re

#: Shortest part worth its own synthesis call. Deliberately small: the original
#: records that the measured win came from leading clauses as short as "Hello,"
#: (6 chars) and "Xin chào," (9), so a larger floor would merge exactly the
#: split that pays. It exists only to absorb sub-word fragments like the "Mr."
#: in "Mr. Smith".
MIN_PART_CHARS = 4

#: Clause and sentence terminators, kept with the text they follow so the engine
#: still sees the punctuation it takes intonation from. The trailing lookahead
#: is load-bearing: requiring whitespace or end-of-text after the mark keeps
#: "3.5" and the Vietnamese decimal comma in "1,5 triệu" from reading as
#: boundaries.
BOUNDARY = re.compile(r"[,;:.!?…]+(?=\s|$)")


def split_into_clauses(text: str) -> list[str]:
    """Break text into clause-level synthesis units.

    Returns a single part when there is no usable boundary, and an empty list
    for blank input — matching the original's documented contract.
    """
    trimmed = text.strip()
    if not trimmed:
        return []

    parts: list[str] = []
    start = 0
    for match in BOUNDARY.finditer(trimmed):
        end = match.end()
        part = trimmed[start:end].strip()
        if part:
            parts.append(part)
        start = end

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
