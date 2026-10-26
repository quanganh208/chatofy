"""Which turns carry no language at all: vocal fillers, backchannel noises,
non-speech tags.

A turn whose reference transcript is only these has no correct language label.
"嗯", "mm hmm" and "ừ" sound alike across the three languages, and the product
handles such a turn the same way whatever it is decided as: transcript only,
nothing translated, the session prior left alone. Ruler v5 therefore leaves
these turns out of every speech criterion, for every language alike, as far
as transcripts reach: VietMed's pause-cut fragments and ViMedCSS have none,
so short vi meets the 300 ms floor only (`excluded.{lang}` shows the gap).

The lexicons were written before any accuracy was read under them. They hold
NON-LEXICAL sounds only: words that mean something ("对", "好的", "yeah",
"okay", "dạ", "vâng") stay counted, because a speaker who says them has chosen
a language.
"""

from __future__ import annotations

import re

#: Interjections and hesitation sounds, per language. zh is matched per
#: character (the transcripts are unsegmented), en and vi per word.
FILLERS: dict[str, frozenset[str]] = {
    "zh": frozenset("嗯呃啊哦额噢唉诶欸哎喔呣哼"),
    "en": frozenset({"um", "umm", "uh", "uhh", "er", "erm", "hmm", "hm", "mm", "mmm", "mhm", "huh",
                     "ah", "oh", "ooh", "eh"}),
    "vi": frozenset({"ừ", "ừm", "ờ", "à", "ơ", "ồ", "a", "ạ", "hừm", "hử", "ư", "ủa", "ô"}),
}

#: Transcriber tags that mark a non-speech event: `<LAUGH>` (EdAcc), `[UNK]` (ASCEND).
_TAG = re.compile(r"<[^>]*>|\[[^\]]*\]")
#: Tags that mean the transcriber heard words they did not write down: the
#: turn has content, just not in the transcript.
_CONTENT_TAGS = frozenset({"<foreign>", "[foreign]"})
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def is_filler_only(text: str | None, lang: str) -> bool | None:
    """True when `text` holds nothing but fillers and non-speech tags; None
    when the transcript cannot tell (missing, or marked unscorable)."""
    if text is None or "IGNORE_TIME_SEGMENT_IN_SCORING" in text:
        return None
    lowered = text.lower()
    if any(tag in _CONTENT_TAGS for tag in _TAG.findall(lowered)):
        return False
    bare = _PUNCT.sub(" ", _TAG.sub(" ", lowered))
    fillers = FILLERS[lang]
    if lang == "zh":
        units = [ch for ch in bare if not ch.isspace()]
        # A Latin word inside a zh turn is content, not a filler.
        return all(ch in fillers for ch in units)
    return all(word in fillers for word in bare.split())
