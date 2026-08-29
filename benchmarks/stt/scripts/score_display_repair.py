"""Score a display arm — LLM repair or deterministic ITN — against the baseline.

Step 3 of 3; see `dump_display_hypotheses.py` for the sequence.

    uv run python scripts/score_display_repair.py                     # LLM repair
    uv run python scripts/score_display_repair.py \\
        --input data/display-itn.jsonl --field itn --no-guard         # ITN

Scores exactly what a reader would SEE, which is not the same as what a producer
returned: a repair the divergence guard rejects is never shown, so the repaired
arm applies the same threshold the product did and falls back to the raw string.
A run that scored the model's raw answers would be measuring a feature that does
not ship.

**References are joined from the manifest by id, not read from the input file.**
The arm files each carry a frozen `ref_text` copied in at the time they were
produced, and `display-repaired.jsonl` is a protected evidence record that must
not be regenerated — so scoring its embedded copy would silently pin the LLM arm
to whatever convention the references had on the day it ran, while a newer arm
was scored against today's. One ruler, loaded once, is the only way two arms are
comparable. `--embedded-references` restores the old behavior, which is how the
pre-re-baseline figures stay reproducible for side-by-side publication.

**`--no-guard` exists because the ITN has no guard**, not as a convenience. Its
output is derived from the raw text by construction and nothing is ever withheld,
so it has no `divergence` field. Synthesizing one to fit the repaired arm's row
shape would make this script print a "0 withheld" statistic describing a
mechanism that does not exist — in a thesis artifact.

Uses the same `display_fidelity` instrument, the same corpus and the same
references as `run_display_baseline.py`, so the columns are comparable by
construction. The audio behind it is one speaker's own voice: internal set,
gitignored, not independently reproducible.
"""

import argparse
import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.display_fidelity import score_corpus  # noqa: E402
from stt_bench.metrics import corpus_wer  # noqa: E402

REPAIRED = BENCH_ROOT / "data" / "display-repaired.jsonl"
MANIFEST = BENCH_ROOT / "data" / "manifest-vi-display.jsonl"

# The divergence threshold the LLM repair arm shipped under. It is now a
# HISTORICAL constant: the guard it mirrored has been deleted along with the
# repair, and this script still applies it only so the recorded arm is scored
# the way it was actually shown. Nothing in the product reads it any more.
MAX_REPAIR_DIVERGENCE = 0.0


def shown(row: dict, field: str, guard: bool) -> tuple[str, bool]:
    """What the reader actually sees, and whether a produced value was withheld.

    Three ways the repair arm falls back to raw, and the product treated them
    identically: the request failed, the answer was empty, or the guard rejected
    it as a paraphrase. Never blank, never partial.

    The flag is returned rather than inferred by comparing the result to `raw`.
    A repair that legitimately changed nothing — already punctuated, no numerals
    — is byte-identical to the raw text, and counting that as a rejection would
    report the guard firing on a turn it never touched.

    With `guard=False` there is no third case: a producer that cannot paraphrase
    needs no paraphrase threshold, and this returns its output untouched.
    """
    produced = row.get(field)
    if not produced or not produced.strip():
        return row["raw"], True
    if not guard:
        return produced, False
    divergence = row.get("divergence")
    if divergence is None or divergence["residual"] > MAX_REPAIR_DIVERGENCE:
        return row["raw"], True
    return produced, False


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a display arm against the references.")
    parser.add_argument("--input", type=Path, default=REPAIRED, help="arm output rows")
    parser.add_argument("--field", default="repaired", help="row key holding the produced text")
    parser.add_argument(
        "--no-guard",
        action="store_true",
        help="the producer has no divergence guard; score its output as shown",
    )
    parser.add_argument("--references", type=Path, default=MANIFEST)
    parser.add_argument(
        "--embedded-references",
        action="store_true",
        help="score against each row's frozen ref_text instead of the manifest",
    )
    args = parser.parse_args()

    rows = load_rows(args.input)

    if not args.embedded_references:
        references = {row["id"]: row for row in load_rows(args.references)}
        missing = [row["id"] for row in rows if row["id"] not in references]
        if missing:
            print(f"error: no reference for {missing}", file=sys.stderr)
            return 1
        # Copied onto the in-memory rows only. The input file is never written.
        for row in rows:
            row["ref_text"] = references[row["id"]]["ref_text"]
            row["proper_nouns"] = references[row["id"]]["proper_nouns"]

    outcomes = [shown(row, args.field, guard=not args.no_guard) for row in rows]
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

    ruler = "embedded" if args.embedded_references else args.references.name
    print(f"\n=== DISPLAY FIDELITY, {len(rows)} utterances (micro) ===")
    print(f"  arm {args.input.name} · field `{args.field}` · references {ruler}")
    print(f"  {'metric':<26} {'baseline':>10}   {args.field:>10}")
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
    # Only meaningful for an arm that can withhold. Printing "0 withheld" for the
    # ITN would describe a guard it does not have.
    if not args.no_guard:
        print(
            f"  fell back to raw: {len(rejected)}/{len(rows)}"
            + (f" {rejected}" if rejected else "")
        )

    # The thesis-facing claim is the pair, not the headline: WER gets WORSE as the
    # display gets better, because the reference numerals the repair now writes
    # correctly are what WER's normalization cannot credit.
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
