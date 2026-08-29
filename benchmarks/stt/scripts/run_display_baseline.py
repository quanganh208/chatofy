"""Score the display-fidelity set against today's shipping output.

This is the "before" the display path has to beat. It deliberately does NOT go through
`normalize_text`: WER's normalization erases casing, punctuation and numeral form,
which is exactly what is being measured here.

    uv run python scripts/run_display_baseline.py

Reads `data/manifest-vi-display.jsonl`. The audio is one speaker's own voice
recorded through the real browser capture chain, so it is personal data, is
gitignored, and these numbers are not independently reproducible — state that
caveat wherever they are quoted.
"""

import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.display_fidelity import score_corpus, score_utterance, summarize  # noqa: E402
from stt_bench.engines import create_engine  # noqa: E402
from stt_bench.manifest import load_manifest  # noqa: E402
from stt_bench.metrics import corpus_wer  # noqa: E402

MANIFEST = BENCH_ROOT / "data" / "manifest-vi-display.jsonl"


def shipping_postprocess(text: str) -> str:
    """Verbatim from services/local-stt/engines/zipformer_vi.py::postprocess.

    Copied rather than imported: the sidecar is a separate uv project, and this
    is the whole of what turns the decoder's output into what the user reads.
    """
    text = text.strip().lower()
    return text[:1].upper() + text[1:]


def main() -> int:
    # Reuse the existing loader for its invariants (ids unique, audio present,
    # duration in range); it does not carry `proper_nouns`, so read those beside it.
    utterances = load_manifest(MANIFEST)
    nouns = {
        r["id"]: r.get("proper_nouns", [])
        for r in (json.loads(l) for l in MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip())
    }

    engine = create_engine("sherpa-zipformer-vi")  # shipping config: greedy, unbiased
    engine.load()

    rows, pairs, refs, hyps = [], [], [], []
    for utt in utterances:
        raw = engine.transcribe(utt.audio_path)
        shown = shipping_postprocess(raw)
        counts = score_utterance(utt.ref_text, shown, nouns[utt.id])
        rows.append((utt.id, shown, summarize(counts), counts))
        pairs.append((utt.ref_text, shown, nouns[utt.id]))
        refs.append(utt.ref_text)
        hyps.append(shown)

    print(f"\n{'id':16} {'chữ số':>10} {'dấu câu F1':>12} {'hoa DTR':>10}")
    print("-" * 52)
    for utt_id, _shown, fid, counts in rows:
        def cell(value, denom):
            return "—" if value is None else f"{value:.2f} ({denom})"
        print(
            f"{utt_id:16} {cell(fid.numeral_recall, counts.numerals_in_reference):>10}"
            f" {cell(fid.punctuation_f1, counts.punctuation_in_reference):>12}"
            f" {cell(fid.proper_noun_accuracy, counts.proper_nouns_present):>10}"
        )

    total = score_corpus(pairs)
    c = total.counts
    print("\n=== BASELINE (micro, gộp toàn tập) ===")
    print(f"  numeral recall        {total.numeral_recall:.4f}   ({c.numerals_matched}/{c.numerals_in_reference})")
    print(f"  numeral hallucinations{c.numerals_hallucinated:>7}")
    print(f"  punctuation F1        {total.punctuation_f1:.4f}   "
          f"(khớp {c.punctuation_matched}, ref {c.punctuation_in_reference}, hyp {c.punctuation_in_hypothesis})")
    print(f"  proper-noun caps      {total.proper_noun_accuracy:.4f}   "
          f"({c.proper_nouns_cased}/{c.proper_nouns_present} nhận ra, khai báo {c.proper_nouns_declared})")
    print(f"  proper-noun coverage  {total.proper_noun_coverage:.4f}")
    print(f"\n  WER vs tham chiếu VIẾT (bối cảnh, KHÔNG phải chỉ số hiển thị): "
          f"{corpus_wer(refs, hyps) * 100:.2f}%")
    print(f"  {len(utterances)} câu, {sum(len(r.split()) for r in refs)} từ tham chiếu\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
