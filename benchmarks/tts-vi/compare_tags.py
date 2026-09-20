"""Did a package upgrade change intelligibility? Compare two run tags, paired.

The main benchmark scores one tag at a time, and the paired bootstrap it records
compares engines *within* a tag. Neither can answer the question this exists for:
whether `vieneu` 3.8.1 reads the same sentences better or worse than 3.3.0, since
those builds live in different tags.

It does not need to. Each tag's `intelligibility.jsonl` already stores the
reference and the hypothesis for every sentence of every arm, so the two tags can
be joined on sentence id and scored with the same paired bootstrap the scorer
uses — the same test over a wider span, at no ASR cost.

Sign convention: A is the NEW tag, so a **negative** `diff` means the new build's
corpus WER is lower, i.e. it improved. Read the interval, not the point estimate —
one spanning zero means this sentence set has not separated the two builds, however
far apart the two WERs happen to look.

The code-switch rows are reported separately because that subset is the reason to
look at all: it is the only part of the conversational set where an English word
sits inside a Vietnamese sentence, and it is measured far worse than the rest.

    uv run python compare_tags.py --base-tag r2 --new-tag v381
"""

import argparse
import json
from pathlib import Path

from tts_vi_bench.asr_judges import SCORING_JUDGE
from tts_vi_bench.metrics import corpus_wer, paired_bootstrap_wer, win_loss_tie

BENCH_ROOT = Path(__file__).resolve().parent
RESULTS = BENCH_ROOT / "results"

#: Reported per arm. `None` is the whole set; the other is the sentence tag.
SUBSETS = [(None, "all"), ("code-switch", "code-switch")]


def arms_in(tag: str) -> set[tuple[str, str, str]]:
    """{(engine, voice_slug, sentence_set)} present in a tag's scored output."""
    path = RESULTS / tag / "intelligibility.jsonl"
    if not path.exists():
        raise SystemExit(
            f"{path} is missing — {tag} has not been scored, so there is nothing to compare."
        )
    found = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            if row.get("type") == "sentence":
                found.add((row["engine"], row["voice_slug"], row["sentence_set"]))
    return found


def rows_for(tag: str, key: tuple[str, str, str]) -> dict[str, dict]:
    """{sentence_id: row} for one arm of one tag."""
    out: dict[str, dict] = {}
    path = RESULTS / tag / "intelligibility.jsonl"
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("type") == "sentence" and (
            row["engine"], row["voice_slug"], row["sentence_set"]
        ) == key:
            out[row["sentence_id"]] = row
    return out


def shared_ids(base: dict[str, dict], new: dict[str, dict], subset: str | None) -> list[str]:
    """Sentences both tags scored, in id order, optionally one tagged subset.

    Id order matches the sentence set's own order, so the pairing is stable and
    the same ids reach both systems — which is what makes the bootstrap paired.
    """
    ids = sorted(set(base) & set(new))
    if subset is not None:
        ids = [i for i in ids if subset in (new[i].get("tags") or [])]
    return ids


def compare(base: dict[str, dict], new: dict[str, dict], subset: str | None) -> dict | None:
    ids = shared_ids(base, new, subset)
    if not ids:
        return None
    refs = [new[i]["reference"] for i in ids]
    hyp_base = [base[i][f"hyp_{SCORING_JUDGE}"] for i in ids]
    hyp_new = [new[i][f"hyp_{SCORING_JUDGE}"] for i in ids]
    return {
        "n": len(ids),
        "wer_base": corpus_wer(refs, hyp_base),
        "wer_new": corpus_wer(refs, hyp_new),
        # A is the new build throughout, so a negative diff reads as "improved"
        # without the reader holding a convention in their head.
        **paired_bootstrap_wer(refs, hyp_new, hyp_base),
        **win_loss_tie(refs, hyp_new, hyp_base),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-tag", default="r2", help="the tag holding the older build")
    parser.add_argument("--new-tag", default="v381", help="the tag holding the newer build")
    parser.add_argument("--out", type=Path, default=RESULTS / "compare-tags.json")
    args = parser.parse_args()

    base_arms, new_arms = arms_in(args.base_tag), arms_in(args.new_tag)
    # Only arms both tags measured: an engine added in the new tag has no baseline,
    # and its absence is not a regression.
    shared = sorted(base_arms & new_arms)
    if not shared:
        raise SystemExit(
            f"no arm is present in both {args.base_tag} and {args.new_tag}; nothing to compare."
        )

    print(f"# {args.base_tag} → {args.new_tag}   (judge: {SCORING_JUDGE})")
    print(f"# A = {args.new_tag}: a negative diff means the new build improved.")
    print()
    header = (f"{'arm':<38}{'subset':<13}{'n':>3}{'WER base':>10}{'WER new':>9}"
              f"{'diff':>8}{'95% CI':>18}{'sep':>5}{'new wins':>10}")
    print(header)
    print("-" * len(header))

    comparisons: dict = {}
    for key in shared:
        base_rows, new_rows = rows_for(args.base_tag, key), rows_for(args.new_tag, key)
        for subset, label in SUBSETS:
            r = compare(base_rows, new_rows, subset)
            if r is None:
                continue
            arm = " / ".join(key)
            ci = f"[{r['ci95_low'] * 100:+.1f}, {r['ci95_high'] * 100:+.1f}]"
            print(f"{arm:<38}{label:<13}{r['n']:>3}{r['wer_base'] * 100:>9.1f}%"
                  f"{r['wer_new'] * 100:>8.1f}%{r['observed_diff'] * 100:>+7.1f}"
                  f"{ci:>18}{'yes' if r['separates'] else 'no':>5}"
                  f"{r['a_wins']:>5}/{r['b_wins']:<4}")
            comparisons[f"{arm}|{label}"] = r

    args.out.write_text(
        json.dumps({"base_tag": args.base_tag, "new_tag": args.new_tag,
                    "judge": SCORING_JUDGE, "comparisons": comparisons},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(f"[done] {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
