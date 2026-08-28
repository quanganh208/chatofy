"""Score the repaired display set against the recorded zero baseline.

Step 3 of 3; see `dump_display_hypotheses.py` for the sequence.

    uv run python scripts/score_display_repair.py

Scores exactly what a reader would SEE, which is not the same as what the model
returned: a repair the divergence guard rejects is never shown, so this applies
the same threshold the product does and falls back to the raw string. A run that
scored the model's raw answers would be measuring a feature that does not ship.

Uses the same `display_fidelity` instrument, the same corpus and the same
references as `run_display_baseline.py`, so the two columns are comparable by
construction. The audio behind it is one speaker's own voice: internal set,
gitignored, not independently reproducible.
"""

import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.display_fidelity import score_corpus  # noqa: E402
from stt_bench.metrics import corpus_wer  # noqa: E402

REPAIRED = BENCH_ROOT / "data" / "display-repaired.jsonl"

# Must equal MAX_REPAIR_DIVERGENCE in packages/ai-providers/src/text/repair-divergence.ts.
# Duplicated across a language boundary rather than shared, and the comment is the
# whole of the enforcement — a number that drifts here would report a gate the
# product does not apply. Zero means "only numeral rewrites are forgiven"; see
# that file for the 22/22 measurement it was set from.
MAX_REPAIR_DIVERGENCE = 0.0


def shown(row: dict) -> tuple[str, bool]:
    """What the reader actually sees, and whether a repair was withheld.

    Three ways to fall back to raw, and the product treats them identically: the
    request failed, the answer was empty, or the guard rejected it as a
    paraphrase. Never blank, never partial.

    The flag is returned rather than inferred by comparing the result to `raw`.
    A repair that legitimately changed nothing — already punctuated, no numerals
    — is byte-identical to the raw text, and counting that as a rejection would
    report the guard firing on a turn it never touched.
    """
    repaired = row.get("repaired")
    if not repaired or not repaired.strip():
        return row["raw"], True
    divergence = row.get("divergence")
    if divergence is None or divergence["residual"] > MAX_REPAIR_DIVERGENCE:
        return row["raw"], True
    return repaired, False


def main() -> int:
    rows = [
        json.loads(line)
        for line in REPAIRED.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    outcomes = [shown(row) for row in rows]
    displayed = [text for text, _ in outcomes]
    rejected = [row["id"] for row, (_, withheld) in zip(rows, outcomes) if withheld]

    repaired_pairs = [
        (row["ref_text"], text, row["proper_nouns"]) for row, text in zip(rows, displayed)
    ]
    baseline_pairs = [(row["ref_text"], row["raw"], row["proper_nouns"]) for row in rows]

    after = score_corpus(repaired_pairs)
    before = score_corpus(baseline_pairs)

    def line(label: str, get, fmt: str = "{:.4f}") -> str:
        b, a = get(before), get(after)
        cell = lambda v: "—" if v is None else fmt.format(v)  # noqa: E731
        return f"  {label:<26} {cell(b):>10} → {cell(a):>10}"

    print(f"\n=== DISPLAY FIDELITY, {len(rows)} utterances (micro) ===")
    print(f"  {'metric':<26} {'baseline':>10}   {'repaired':>10}")
    print(line("numeral recall", lambda s: s.numeral_recall))
    print(line("punctuation F1", lambda s: s.punctuation_f1))
    print(line("proper-noun caps", lambda s: s.proper_noun_accuracy))
    print(
        f"  {'numeral hallucinations':<26} "
        f"{before.counts.numerals_hallucinated:>10} → {after.counts.numerals_hallucinated:>10}"
    )
    print(
        f"\n  numerals {after.counts.numerals_matched}/{after.counts.numerals_in_reference}"
        f" · punctuation matched {after.counts.punctuation_matched}"
        f" (ref {after.counts.punctuation_in_reference}, hyp {after.counts.punctuation_in_hypothesis})"
        f" · proper nouns {after.counts.proper_nouns_cased}/{after.counts.proper_nouns_present}"
    )

    refs = [row["ref_text"] for row in rows]
    print(
        f"\n  WER vs tham chiếu VIẾT (bối cảnh, KHÔNG phải chỉ số hiển thị): "
        f"{corpus_wer(refs, [r['raw'] for r in rows]) * 100:.2f}% → "
        f"{corpus_wer(refs, displayed) * 100:.2f}%"
    )
    print(f"  fell back to raw: {len(rejected)}/{len(rows)}" + (f" {rejected}" if rejected else ""))

    # The thesis-facing claim is the pair, not the headline: WER gets WORSE as the
    # display gets better, because the reference numerals the repair now writes
    # correctly are what WER's normalization cannot credit.
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
