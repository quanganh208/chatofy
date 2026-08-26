"""Wiring check: same-speaker similarity must exceed different-speaker.

Deliberately NOT an accuracy measurement. It runs on close-talking Mandarin
clips shipped with the sherpa-onnx release — a channel and a language nothing in
this product uses. Its only job is to prove the extractor is wired up correctly:
audio reaches the model, vectors come back, and they are ordered the way
speaker embeddings are supposed to be ordered.

If this fails, something is wrong in the plumbing, not in the science. Real
accuracy — Vietnamese, far-field, short turns, browser DSP — is Phase 3's job,
and its numbers will be much worse than anything here. Do not read this as
evidence the feature works.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from speaker_bench.embed import CANDIDATES, SHIPPING, SpeakerEmbedder, cosine
from speaker_bench.io import load_audio, pcm16_to_float, to_pcm16_16k

BENCH_ROOT = Path(__file__).resolve().parent.parent
CLIPS = BENCH_ROOT / "models" / "smoke-clips"

#: Three utterances per speaker, from three speakers.
#:
#: Three rather than two because two gives a single same-speaker pair per
#: speaker, and one pair is a coin toss — three gives three pairs each, so a
#: model has to be consistently right rather than luckily right once.
SPEAKERS = {
    "fangjun": ["fangjun-sr-1.wav", "fangjun-sr-2.wav", "fangjun-test-sr-1.wav"],
    "leijun": ["leijun-sr-1.wav", "leijun-sr-2.wav", "leijun-test-sr-1.wav"],
    "liudehua": ["liudehua-sr-1.wav", "liudehua-sr-2.wav", "liudehua-test-sr-1.wav"],
}

AVAILABLE = [spec for spec in CANDIDATES.values() if spec.path.exists()]
AVAILABLE_SHIPPING = [spec for spec in SHIPPING.values() if spec.path.exists()]

pytestmark = pytest.mark.skipif(
    not AVAILABLE or not CLIPS.is_dir(),
    reason="run scripts/download_models.py first",
)


def _embed(embedder: SpeakerEmbedder, name: str):
    audio = load_audio(CLIPS / name)
    return embedder.embed(pcm16_to_float(to_pcm16_16k(audio)))


def _separation(spec) -> tuple[float, float]:
    """Worst same-speaker similarity and best different-speaker similarity."""
    embedder = SpeakerEmbedder(spec)
    vectors = {
        speaker: [_embed(embedder, name) for name in names]
        for speaker, names in SPEAKERS.items()
    }
    same = [
        cosine(clips[i], clips[j])
        for clips in vectors.values()
        for i in range(len(clips))
        for j in range(i + 1, len(clips))
    ]
    different = [
        cosine(left, right)
        for a in SPEAKERS
        for b in SPEAKERS
        if a < b
        for left in vectors[a]
        for right in vectors[b]
    ]
    return min(same), max(different)


@pytest.mark.parametrize("spec", AVAILABLE_SHIPPING, ids=lambda s: s.key)
def test_same_speaker_scores_above_different_speaker(spec) -> None:
    missing = [n for names in SPEAKERS.values() for n in names if not (CLIPS / n).exists()]
    if missing:
        pytest.skip(f"missing smoke clips: {missing}")

    worst_same, best_different = _separation(spec)

    # The gap, not a threshold: no absolute cosine value transfers across
    # channels, which is the whole reason Phase 3 derives its own thresholds
    # from this project's own recordings rather than from any published number.
    #
    # Shipping candidates only. A baseline is excluded deliberately — see
    # test_english_baseline_does_not_separate_mandarin_speakers.
    assert worst_same > best_different, (
        f"{spec.key}: same-speaker min {worst_same:.3f} did not beat "
        f"different-speaker max {best_different:.3f} — the extractor is miswired"
    )


@pytest.mark.parametrize("spec", AVAILABLE, ids=lambda s: s.key)
def test_embeddings_are_unit_length(spec) -> None:
    """Every consumer compares with a plain dot product and relies on this."""
    name = SPEAKERS["fangjun"][0]
    if not (CLIPS / name).exists():
        pytest.skip(f"missing smoke clip: {name}")

    vector = _embed(SpeakerEmbedder(spec), name)
    assert float(np.linalg.norm(vector)) == pytest.approx(1.0, abs=1e-5)


@pytest.mark.skipif(
    not [s for s in CANDIDATES.values() if s.baseline and s.path.exists()],
    reason="baseline model not downloaded",
)
def test_english_baseline_does_not_separate_mandarin_speakers() -> None:
    """Record the cross-lingual failure of the English VoxCeleb baseline.

    Measured here, not asserted as a wiring check: on these Mandarin clips the
    baseline scores same-speaker pairs as low as ~0.47 while scoring
    different-speaker pairs as high as ~0.84 — it is worse than useless, and it
    fails through the SAME code path the two zh-trained models pass through, so
    this is the model rather than the plumbing.

    Two advisory opinions disagreed about whether VoxCeleb-trained models are
    viable for Vietnamese. This is one data point on that question, and it is
    only a data point: these are Mandarin, close-talking, and read — none of
    which is the product's channel. Phase 3 answers it for Vietnamese, far-field,
    with browser DSP. The test exists so that if the ordering ever reverses,
    somebody has to come back and read this note.
    """
    baseline = next(s for s in CANDIDATES.values() if s.baseline and s.path.exists())
    primary = next(iter(s for s in SHIPPING.values() if s.path.exists()), None)
    if primary is None:
        pytest.skip("no shipping candidate downloaded to compare against")

    base_same, base_diff = _separation(baseline)
    ship_same, ship_diff = _separation(primary)

    # Assert the actual finding, which is an INVERSION rather than merely a
    # smaller margin: the baseline scores some same-speaker pairs BELOW some
    # different-speaker pairs. A margin-comparison alone would pass happily even
    # if the baseline separated speakers cleanly, which would not match the name
    # of this test or the note above.
    assert base_same < base_diff, (
        f"{baseline.key} DID separate Mandarin speakers "
        f"(same-min {base_same:.3f} > diff-max {base_diff:.3f}). The measured "
        "cross-lingual failure recorded in this test no longer reproduces — "
        "re-read the note above and the plan's model-candidate section."
    )
    assert (ship_same - ship_diff) > (base_same - base_diff), (
        f"{baseline.key} margin {base_same - base_diff:.3f} is not worse than "
        f"{primary.key}'s {ship_same - ship_diff:.3f}"
    )


@pytest.mark.parametrize("spec", AVAILABLE, ids=lambda s: s.key)
def test_embeddings_are_not_degenerate(spec) -> None:
    """Vectors must actually vary with the input.

    The baseline model is excluded from the same>different ordering assertion,
    which would otherwise be its only wiring coverage beyond unit length. A model
    that returned a near-constant vector for every clip would pass both the
    unit-length check and, vacuously, nothing else — so check that distinct
    speakers do not collapse onto one point.
    """
    missing = [n for names in SPEAKERS.values() for n in names if not (CLIPS / n).exists()]
    if missing:
        pytest.skip(f"missing smoke clips: {missing}")

    embedder = SpeakerEmbedder(spec)
    firsts = [_embed(embedder, names[0]) for names in SPEAKERS.values()]
    cross = [cosine(firsts[i], firsts[j]) for i in range(len(firsts)) for j in range(i + 1, len(firsts))]

    assert max(cross) < 0.99, (
        f"{spec.key}: different speakers collapsed to cosine {max(cross):.4f} — "
        "the extractor is returning a near-constant vector"
    )
