"""Corpus WER and CER, vendored from `benchmarks/stt/stt_bench/metrics.py`.

Same functions, same normalizer, so a number here sits beside the STT harness's
numbers without an asterisk — which is what makes the human-speech control floors
in `docs/development-journey.md` applicable to this harness at all.

Added here and not in the STT copy: a paired bootstrap over sentences. The
r1-versus-r2 spread is the right significance guard for latency, and a vacuous
one for WER — synthesis is seeded and the ASR decodes greedily, so a second run
transcribes bit-identical audio and any gap at all would read as clean
separation. The real uncertainty is which sentences happen to be in the set.
"""

import jiwer
import numpy as np

from .text_normalize import normalize_text


def corpus_wer(references: list[str], hypotheses: list[str]) -> float:
    """Corpus-level WER over normalized ref/hyp pairs (0.0-1.0+)."""
    if len(references) != len(hypotheses):
        raise ValueError(f"ref/hyp count mismatch: {len(references)} vs {len(hypotheses)}")
    return jiwer.wer([normalize_text(r) for r in references],
                     [normalize_text(h) for h in hypotheses])


def corpus_cer(references: list[str], hypotheses: list[str]) -> float:
    """Corpus-level CER over normalized ref/hyp pairs (0.0-1.0+).

    Reported alongside WER because Vietnamese carries meaning in diacritics that
    WER cannot resolve: a hypothesis differing from its reference by one tone
    mark loses the whole word to WER, exactly as an unrelated word would. CER
    separates a near-miss from a miss, and is the metric to read on vi.
    """
    if len(references) != len(hypotheses):
        raise ValueError(f"ref/hyp count mismatch: {len(references)} vs {len(hypotheses)}")
    return jiwer.cer([normalize_text(r) for r in references],
                     [normalize_text(h) for h in hypotheses])


def sentence_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    """(edit distance in words, reference word count) for one pair.

    Corpus WER is the ratio of the summed numerators to the summed
    denominators, not the mean of per-sentence rates, so the bootstrap has to
    resample these pairs rather than resampling rates.
    """
    ref, hyp = normalize_text(reference), normalize_text(hypothesis)
    n_ref = len(ref.split())
    if n_ref == 0:
        return 0, 0
    out = jiwer.process_words([ref], [hyp])
    return out.substitutions + out.deletions + out.insertions, n_ref


def paired_bootstrap_wer(
    references: list[str],
    hyp_a: list[str],
    hyp_b: list[str],
    n_resamples: int = 10_000,
    seed: int = 20260914,
) -> dict:
    """Is A's corpus WER really below B's, or is it the sentence sample?

    Paired: each resample draws the same sentence indices for both systems, so
    the comparison is not contaminated by one system happening to be scored on
    easier sentences than the other.

    Returns the observed difference (A - B, so negative favours A), a 95%
    interval on it, and the share of resamples in which A won. An interval
    spanning zero is a tie, and must be reported as one.
    """
    if not (len(references) == len(hyp_a) == len(hyp_b)):
        raise ValueError("references and both hypothesis lists must be the same length")

    pairs_a = np.array([sentence_errors(r, h) for r, h in zip(references, hyp_a)], dtype=float)
    pairs_b = np.array([sentence_errors(r, h) for r, h in zip(references, hyp_b)], dtype=float)

    def wer_of(pairs, idx):
        denom = pairs[idx, 1].sum()
        return float(pairs[idx, 0].sum() / denom) if denom else float("nan")

    all_idx = np.arange(len(references))
    observed = wer_of(pairs_a, all_idx) - wer_of(pairs_b, all_idx)

    rng = np.random.default_rng(seed)
    diffs = np.empty(n_resamples)
    for i in range(n_resamples):
        idx = rng.integers(0, len(references), len(references))
        diffs[i] = wer_of(pairs_a, idx) - wer_of(pairs_b, idx)

    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {
        "observed_diff": observed,
        "ci95_low": float(lo),
        "ci95_high": float(hi),
        "p_a_better": float((diffs < 0).mean()),
        "separates": bool(lo > 0 or hi < 0),
        "n_sentences": len(references),
        "n_resamples": n_resamples,
    }


def win_loss_tie(references: list[str], hyp_a: list[str], hyp_b: list[str]) -> dict:
    """Per-sentence outcome counts — the cheap companion to the bootstrap."""
    wins = losses = ties = 0
    for ref, a, b in zip(references, hyp_a, hyp_b):
        ea, na = sentence_errors(ref, a)
        eb, _ = sentence_errors(ref, b)
        if na == 0:
            continue
        if ea < eb:
            wins += 1
        elif ea > eb:
            losses += 1
        else:
            ties += 1
    return {"a_wins": wins, "b_wins": losses, "ties": ties}
