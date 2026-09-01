"""Display-fidelity metrics — what WER structurally cannot see.

`metrics.py` scores through `normalize_text`, which lowercases, strips
punctuation, and leaves numbers as written. That is correct for comparing
recognizers and it is exactly why it is blind here: measured over this repo's
own `results/r1/`, 0 of 50 VIVOS references carry a digit or a punctuation mark,
so there is no label for the thing the user actually complains about. Worse, a
hypothesis that correctly writes `17:00` scores three word errors against a
reference reading `MƯỜI BẢY GIỜ` (normalization splits it to `17 00`, so two
substitutions and a deletion) — repairing the display makes the headline WER
*worse*.

Measured on real speech: one take scored 4.3% WER against a spoken reference and
26.8% against the written form of the same sentence, the whole 9-error gap being
one date. A perfect recognizer fails written Vietnamese. (The per-sentence record
behind those two numbers has been retired along with the plan tree; the numbers
stay here because they are the reason this module scores the way it does.)

So this module scores the raw string. `normalize_text` is never applied on this
path; applying it would erase precisely what is being measured.

Three metrics, plus one guard:

- **numeral recall** — did the reference's numeric forms survive verbatim
- **punctuation F1** — placement, anchored to the preceding word, not a count
- **proper-noun capitalization** — over the nouns the reference declares
- **numeral hallucinations** — numeral forms the reference does not account for.
  The motivating case is invention by an over-eager ITN pass (`không phải`, the
  negation, rewritten to `0 phải`). Read the name loosely: it is a multiset
  difference, so a *reformat* (`2/9` emitted as `2-9`) and a *repeat* also raise
  it. A reformat therefore costs both a recall miss and a hallucination — one
  defect counted in two places, which matters when quoting the pair in a table.

Aggregation is micro (pooled counts), not a mean of per-utterance rates: on a
20-utterance set a per-utterance mean lets one short utterance outweigh a long
one. A metric with no material to score returns `None` rather than a vacuous
1.0, so an absent signal can never inflate a corpus number.
"""

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, fields

#: Marks whose placement is scored. Scoped to these two by the plan; Vietnamese
#: display text uses both heavily and neither survives `normalize_text`.
PUNCTUATION_MARKS = ",."

#: Anchor for a mark with no preceding word, so a leading mark is still a
#: distinguishable placement rather than silently dropped.
SENTENCE_START = "<s>"

#: A numeral form is a digit run plus any separators that sit BETWEEN digits:
#: `2/9/1945`, `17:00`, `0,4`, `1.000.000`, `30`. Matching the separators here is
#: what keeps a Vietnamese decimal comma out of the punctuation metric — the
#: comma in `0,4` is part of the number, not a clause boundary. The mechanism is
#: greedy consumption from the leading digit, not alternation order: a separator
#: only joins when a digit follows it, so the period ending `... năm 1945.` stays
#: punctuation while the ones inside `1.000.000` do not.
_NUMERAL = r"\d+(?:[.,:/]\d+)*"

_TOKEN_RE = re.compile(
    rf"(?P<num>{_NUMERAL})|(?P<word>[^\W\d_]+)|(?P<mark>[{re.escape(PUNCTUATION_MARKS)}])",
    re.UNICODE,
)


def _fold(text: str) -> str:
    """Casefold for comparison. Diacritics are preserved — they carry meaning in vi.

    The NFC pass here is redundant defense, not the load-bearing one: every
    caller hands it a token already cut from NFC-normalized text. The composition
    that actually matters happens once per string, before tokenizing.
    """
    return unicodedata.normalize("NFC", text).lower()


def _numerals(text: str) -> Counter:
    text = unicodedata.normalize("NFC", text)
    return Counter(m.group("num") for m in _TOKEN_RE.finditer(text) if m.lastgroup == "num")


def _punctuation_pairs(text: str) -> Counter:
    """Multiset of (preceding word, mark).

    Anchoring to the preceding word is what makes this placement rather than a
    count: a hypothesis with the right number of commas in the wrong clauses
    scores zero, which is the behavior worth having.

    A run of the same mark counts once. Vietnamese display text uses `...`, and
    a reader sees one ellipsis, not three periods; counting three would score a
    correct terminal mark at F1 0.5 against it.

    Known limit: the key is (word, mark), so two different placements after the
    SAME word collide — `"anh nói, chị nói, tôi im"` against `"anh nói, chị nói
    tôi im"` with a doubled comma would net out. It needs one word to precede
    marks at two positions, and separating those cases needs optimal assignment
    rather than a multiset, which is far more machine than the case is worth.
    """
    text = unicodedata.normalize("NFC", text)
    pairs: Counter = Counter()
    previous = SENTENCE_START
    previous_mark: str | None = None
    for match in _TOKEN_RE.finditer(text):
        if match.lastgroup == "mark":
            mark = match.group()
            if mark != previous_mark:
                pairs[(previous, mark)] += 1
                previous_mark = mark
        else:
            previous = _fold(match.group())
            previous_mark = None
    return pairs


def _words(text: str) -> list[str]:
    """Word and numeral tokens in order, marks dropped, original casing kept."""
    text = unicodedata.normalize("NFC", text)
    return [m.group() for m in _TOKEN_RE.finditer(text) if m.lastgroup in ("word", "num")]


def _proper_noun_counts(reference_nouns: list[str], hypothesis: str) -> tuple[int, int]:
    """(present, correctly_cased) for the declared nouns.

    `present` counts a noun whose WORDS the recognizer got, case aside. Scoring
    capitalization over nouns the recognizer never produced would punish the
    same miss twice — once in WER, once here — and would move this metric when
    acoustic quality changes, which is the opposite of what it is for. Report
    coverage next to the rate so a low denominator stays visible.

    Matching is greedy first-position, not optimal assignment: `["Hà Nội"]`
    scores (1, 0) against `"hà nội và Hà Nội"` but (1, 1) against the reverse.
    That is defensible only because the declared list mirrors the reference's
    own multiplicity — one listing per occurrence — so first-position and
    in-order are the same thing for a well-formed manifest.
    """
    hypothesis_words = _words(hypothesis)
    folded = [_fold(word) for word in hypothesis_words]
    present = 0
    correct = 0
    # A noun listed twice means the reference says it twice, so it must match two
    # DIFFERENT occurrences. Without this the second listing would re-match the
    # first occurrence and score the same word twice.
    claimed: set[int] = set()
    for noun in reference_nouns:
        target = _words(noun)
        if not target:
            continue
        folded_target = [_fold(word) for word in target]
        width = len(folded_target)
        for start in range(len(folded) - width + 1):
            if start in claimed or folded[start : start + width] != folded_target:
                continue
            claimed.add(start)
            present += 1
            if hypothesis_words[start : start + width] == target:
                correct += 1
            break
    return present, correct


@dataclass(frozen=True)
class DisplayCounts:
    """Pooled raw counts. Rates are derived so utterances can be summed."""

    numerals_in_reference: int = 0
    numerals_matched: int = 0
    numerals_hallucinated: int = 0
    punctuation_in_reference: int = 0
    punctuation_in_hypothesis: int = 0
    punctuation_matched: int = 0
    proper_nouns_declared: int = 0
    proper_nouns_present: int = 0
    proper_nouns_cased: int = 0

    def __add__(self, other: "DisplayCounts") -> "DisplayCounts":
        # Keyword-expanded over `dataclasses.fields`, not positional over
        # `__dataclass_fields__`: the former cannot start summing a field into
        # its neighbour, and skips ClassVar / init=False pseudo-fields that
        # would otherwise raise on construction.
        return DisplayCounts(
            **{f.name: getattr(self, f.name) + getattr(other, f.name) for f in fields(self)}
        )


def score_utterance(
    reference: str, hypothesis: str, proper_nouns: list[str] | None = None
) -> DisplayCounts:
    """Count one reference/hypothesis pair. Raw strings — no normalization."""
    reference_numerals = _numerals(reference)
    hypothesis_numerals = _numerals(hypothesis)
    reference_punctuation = _punctuation_pairs(reference)
    hypothesis_punctuation = _punctuation_pairs(hypothesis)
    nouns = proper_nouns or []
    present, cased = _proper_noun_counts(nouns, hypothesis)

    return DisplayCounts(
        numerals_in_reference=sum(reference_numerals.values()),
        numerals_matched=sum((reference_numerals & hypothesis_numerals).values()),
        numerals_hallucinated=sum((hypothesis_numerals - reference_numerals).values()),
        punctuation_in_reference=sum(reference_punctuation.values()),
        punctuation_in_hypothesis=sum(hypothesis_punctuation.values()),
        punctuation_matched=sum((reference_punctuation & hypothesis_punctuation).values()),
        proper_nouns_declared=len(nouns),
        proper_nouns_present=present,
        proper_nouns_cased=cased,
    )


@dataclass(frozen=True)
class DisplayFidelity:
    """Derived rates. `None` means the corpus offered nothing to score."""

    numeral_recall: float | None
    numeral_hallucinations: int
    punctuation_precision: float | None
    punctuation_recall: float | None
    punctuation_f1: float | None
    proper_noun_accuracy: float | None
    proper_noun_coverage: float | None
    counts: DisplayCounts


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def summarize(counts: DisplayCounts) -> DisplayFidelity:
    precision = _ratio(counts.punctuation_matched, counts.punctuation_in_hypothesis)
    recall = _ratio(counts.punctuation_matched, counts.punctuation_in_reference)
    if precision is None and recall is None:
        f1 = None
    elif not precision or not recall:
        # One side produced marks and the other did not: a real zero, not an
        # absent signal. Only "neither side has any" is unscoreable.
        f1 = 0.0
    else:
        f1 = 2 * precision * recall / (precision + recall)

    return DisplayFidelity(
        numeral_recall=_ratio(counts.numerals_matched, counts.numerals_in_reference),
        numeral_hallucinations=counts.numerals_hallucinated,
        punctuation_precision=precision,
        punctuation_recall=recall,
        punctuation_f1=f1,
        proper_noun_accuracy=_ratio(counts.proper_nouns_cased, counts.proper_nouns_present),
        proper_noun_coverage=_ratio(counts.proper_nouns_present, counts.proper_nouns_declared),
        counts=counts,
    )


def score_corpus(pairs: list[tuple[str, str, list[str]]]) -> DisplayFidelity:
    """Micro-averaged fidelity over (reference, hypothesis, proper_nouns) rows."""
    total = DisplayCounts()
    for reference, hypothesis, nouns in pairs:
        total = total + score_utterance(reference, hypothesis, nouns)
    return summarize(total)
