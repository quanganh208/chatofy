"""Assert every display reference is written in the one display convention.

    uv run python scripts/check_display_convention.py

`display_fidelity.py` scores numerals as a MULTISET DIFFERENCE, and says so: a
reformat costs a recall miss *and* a hallucination, one defect counted twice. So
a reference written in a different numeral convention than the thing being
measured does not merely mis-calibrate the score — it makes a correct output
unscoreable. This script is what keeps the references and the producer speaking
the same language, and it is meant to be run BEFORE editing a reference, so its
output is the edit list rather than a rubber stamp on one.

The convention, in full:

    clock       H:MM, 24-hour, hour NOT zero-padded          6:00, 14:30
    date        DD/MM[/YYYY], day and month zero-padded      10/02/2026
    decimal     comma                                        0,4
    thousands   dot                                          2.500, 120.000
    units       as SPOKEN, never abbreviated                 0,4 mét

Three kinds of bare 4+-digit run are exempt from thousands grouping, because
none of them is a quantity: a year (`năm 1913`), a year inside a date
(`02/09/1945`), and an identifier (`số 4472`). Grouping any of them would be
wrong Vietnamese, not merely unconventional.

**The unit rule is checked against the recognizer, not against a taste.** D1
says units stay "as spoken", and the only evidence of what was spoken is what
the recognizer produced — so an abbreviation in a reference is an error exactly
when the recognizer did not itself emit that token. `125 km` passes because the
decoder really wrote `km`; `0,4 m` fails because the decoder wrote `mét`. This
is the difference between a convention and a preference, and it is why this file
reads `display-hypotheses.jsonl` instead of hardcoding a list of forbidden
units.
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent

MANIFEST = BENCH_ROOT / "data" / "manifest-vi-display.jsonl"
HYPOTHESES = BENCH_ROOT / "data" / "display-hypotheses.jsonl"

#: Same shape as `display_fidelity._NUMERAL`, deliberately. A rule checked here
#: against a different tokenization than the scorer uses would pass a reference
#: the scorer still splits differently.
NUMERAL = re.compile(r"\d+(?:[.,:/]\d+)*")

#: Unit tokens short enough to be an abbreviation rather than a spoken word.
#: Membership only selects what gets CHECKED against the recognizer; it never
#: decides on its own that a token is wrong.
ABBREVIATIONS = {
    "m",
    "km",
    "cm",
    "mm",
    "kg",
    "g",
    "ha",
    "l",
    "ml",
    "c",
    "h",
    "t",
}

#: A 4+-digit run is allowed to stay ungrouped when one of these precedes it.
#: `năm` introduces a year, `số` an identifier — neither is a quantity, and
#: `2.026` or `số 4.472` would both be wrong.
UNGROUPED_MARKERS = {"năm", "số"}

WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def tokens(text: str) -> list[str]:
    return [fold(m.group()) for m in WORD.finditer(text)]


def preceding_word(text: str, start: int) -> str | None:
    """The word immediately before `start`, or None if a non-word sits between."""
    before = text[:start].rstrip()
    match = None
    for match in WORD.finditer(before):
        pass
    if match is None or match.end() != len(before):
        return None
    return fold(match.group())


def check_numeral(form: str, previous: str | None) -> str | None:
    """The reason `form` violates the convention, or None if it conforms."""
    if ":" in form:
        if not re.fullmatch(r"\d{1,2}:\d{2}", form):
            return "clock must be H:MM"
        hour = form.split(":")[0]
        if len(hour) == 2 and hour[0] == "0":
            return "clock hour must not be zero-padded"
        return None

    if "/" in form:
        if not re.fullmatch(r"\d{2}/\d{2}(?:/\d{4})?", form):
            return "date must be DD/MM[/YYYY] with day and month zero-padded"
        return None

    if "," in form:
        if not re.fullmatch(r"\d{1,3}(?:\.\d{3})*,\d+", form):
            return "decimal must be a comma, with any thousands part dot-grouped"
        return None

    if "." in form:
        if not re.fullmatch(r"\d{1,3}(?:\.\d{3})+", form):
            return "a dot must be a thousands separator, in groups of three"
        return None

    if len(form) >= 4 and previous not in UNGROUPED_MARKERS:
        return "a 4+-digit quantity must be dot-grouped (or follow `năm`/`số`)"

    return None


def check_units(ref_text: str, raw: str | None) -> list[str]:
    """Abbreviated units in the reference that the recognizer did not itself emit."""
    if raw is None:
        return []
    spoken = set(tokens(raw))
    problems = []
    for token in tokens(ref_text):
        if token in ABBREVIATIONS and token not in spoken:
            problems.append(f"unit `{token}` is an abbreviation the recognizer did not emit")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--hypotheses", type=Path, default=HYPOTHESES)
    args = parser.parse_args()

    raws: dict[str, str] = {}
    if args.hypotheses.exists():
        for line in args.hypotheses.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                raws[row["id"]] = row["raw"]

    rows = [
        json.loads(line)
        for line in args.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    flagged = 0
    for row in rows:
        text = unicodedata.normalize("NFC", row["ref_text"])
        problems = []
        for match in NUMERAL.finditer(text):
            reason = check_numeral(match.group(), preceding_word(text, match.start()))
            if reason:
                problems.append(f"`{match.group()}` — {reason}")
        problems.extend(check_units(text, raws.get(row["id"])))

        if problems:
            flagged += 1
            print(f"\n{row['id']}")
            print(f"  ref  {row['ref_text']}")
            if row["id"] in raws:
                print(f"  raw  {raws[row['id']]}")
            for problem in problems:
                print(f"   ✗ {problem}")

    print(f"\n{len(rows) - flagged}/{len(rows)} references conform; {flagged} flagged\n")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main())
