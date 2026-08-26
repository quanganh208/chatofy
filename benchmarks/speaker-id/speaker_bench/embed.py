"""Speaker embedding extraction over sherpa-onnx.

No new dependency: `sherpa-onnx==1.13.4` — already pinned by the STT sidecar —
exports `SpeakerEmbeddingExtractor`. Only the weights are new.

Embeddings come out L2-normalised, always. Every consumer downstream compares
with cosine similarity, and normalising at the boundary is what lets them use a
plain dot product without each one re-deriving the same step (and eventually
one of them forgetting).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import sherpa_onnx

from .segment import SAMPLE_RATE

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"


@dataclass(frozen=True)
class ModelSpec:
    """One embedding model candidate.

    ``dim`` is the MEASURED embedding dimension, read off the loaded extractor
    rather than taken from release notes (which do not state it consistently).
    :meth:`SpeakerEmbedder.dim` remains the authority; this is a convenience for
    reporting and a tripwire if a re-download ever changes a model underneath us.
    """

    key: str
    filename: str
    note: str
    dim: int | None = None
    #: A baseline is measured for comparison but is not a shipping candidate.
    #: Nothing may assert that a baseline behaves well — the point of measuring
    #: it is that we do not know that it does.
    baseline: bool = False

    @property
    def path(self) -> Path:
        return MODELS_DIR / self.filename


#: The candidates Phase 3 decides between. Two advisory opinions disagreed on
#: whether VoxCeleb-trained models are viable for Vietnamese, so the baseline is
#: measured rather than argued about — that disagreement is exactly why it ships
#: as a bench candidate instead of a footnote.
#:
#: NOTE: no int8 variant exists for ANY speaker embedding model in the
#: sherpa-onnx release (unlike the ASR models). fp32 on CPU is expected; do not
#: self-quantise before measuring.
CANDIDATES: dict[str, ModelSpec] = {
    "eres2netv2": ModelSpec(
        key="eres2netv2",
        filename="3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",
        note="Primary. Best published short-duration numbers; 200k-speaker tonal corpus.",
        dim=192,
    ),
    "campplus": ModelSpec(
        key="campplus",
        filename="3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        note="Challenger. The only explicitly bilingual (zh+en) model in the zoo; 2-4x cheaper.",
        dim=192,
    ),
    "wespeaker_en": ModelSpec(
        key="wespeaker_en",
        filename="wespeaker_en_voxceleb_CAM++.onnx",
        note="Baseline only. English VoxCeleb (~7k speakers); measured, not shipped.",
        dim=512,
        baseline=True,
    ),
}


class SpeakerEmbedder:
    """One warm extractor, bound to a single model.

    The lock is per-extractor and mirrors the STT sidecar's own reasoning: a
    single sherpa-onnx object is not assumed safe for concurrent use.

    ``num_threads`` defaults to 2 rather than the sidecar's 8. The embedding nets
    are small, and in production this runs alongside an STT recognizer that
    already claims 8 threads on an 8-core box — asking for 8 more would
    oversubscribe. Phase 5 measures the right value; this default is the design's
    starting guess, not a measurement.
    """

    def __init__(self, spec: ModelSpec, *, num_threads: int = 2) -> None:
        if not spec.path.exists():
            raise FileNotFoundError(
                f"{spec.path} is missing. Run: python scripts/download_models.py"
            )
        self.spec = spec
        self._lock = threading.Lock()
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(spec.path),
            num_threads=num_threads,
            debug=False,
        )
        if not config.validate():
            raise RuntimeError(f"invalid extractor config for {spec.key}: {spec.path}")
        self._extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)

    @property
    def dim(self) -> int:
        return int(self._extractor.dim)

    def embed(self, samples: np.ndarray, *, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        """Embed one utterance of float32 mono samples in -1..1.

        Returns an L2-normalised float32 vector. A silent (all-zero) input would
        otherwise divide by zero and produce NaNs that propagate into every
        similarity downstream, so it raises instead — a caller handing over
        silence has a bug worth seeing.
        """
        if samples.size == 0:
            raise ValueError("cannot embed an empty utterance")
        if sample_rate != SAMPLE_RATE:
            # Whether sherpa-onnx resamples internally is not documented, and a
            # silent internal resample would mean the bench measures a different
            # audio path than production's. Refuse rather than find out later.
            raise ValueError(
                f"expected {SAMPLE_RATE} Hz, got {sample_rate}; resample with "
                "io.to_pcm16_16k() so the bench matches the capture path"
            )

        audio = np.ascontiguousarray(samples, dtype=np.float32)
        with self._lock:
            stream = self._extractor.create_stream()
            stream.accept_waveform(sample_rate=sample_rate, waveform=audio)
            stream.input_finished()
            if not self._extractor.is_ready(stream):
                raise RuntimeError(
                    f"{self.spec.key}: extractor not ready after "
                    f"{len(audio) / sample_rate:.2f}s of audio"
                )
            vector = np.asarray(self._extractor.compute(stream), dtype=np.float32)

        norm = float(np.linalg.norm(vector))
        if norm == 0.0:
            raise RuntimeError(f"{self.spec.key}: produced a zero embedding")
        return vector / norm


def unit(vector: np.ndarray) -> np.ndarray:
    """L2-normalise, raising on a zero vector rather than emitting NaNs.

    Needed because **a centroid is not a unit vector**. The accepted design
    clusters by a duration-weighted mean of embeddings, and the mean of unit
    vectors has norm well below 1 — typically 0.6-0.9 even for a tight cluster,
    and lower the looser the cluster. Phase 4 must call this on every centroid
    before comparing it with :func:`cosine`.
    """
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("cannot normalise a zero vector")
    return vector / norm


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity of two **unit** vectors.

    A plain dot product, because :meth:`SpeakerEmbedder.embed` guarantees unit
    length on everything it returns.

    The assertion is not pedantry, and it is aimed squarely at Phase 4. Passing a
    raw centroid here scales every similarity down by that centroid's norm, by an
    amount that varies with cluster tightness — so thresholds calibrated on
    pairwise comparisons in Phase 3 (unit vectors) would silently fail to
    transfer to session clustering in Phase 4 (centroids). That surfaces as
    CALIBRATION-BLOCKED, the plan's third gate outcome, for a purely arithmetic
    reason that has nothing to do with speakers. Call :func:`unit` on centroids.
    """
    for name, vector in (("a", a), ("b", b)):
        norm = float(np.linalg.norm(vector))
        if abs(norm - 1.0) > 1e-3:
            raise ValueError(
                f"cosine() argument {name} has norm {norm:.4f}, not 1. "
                "Centroids are not unit vectors — call unit() first."
            )
    return float(np.dot(a, b))


#: Candidates that could actually ship, i.e. everything that is not a baseline.
SHIPPING = {key: spec for key, spec in CANDIDATES.items() if not spec.baseline}

__all__ = [
    "CANDIDATES",
    "MODELS_DIR",
    "SHIPPING",
    "ModelSpec",
    "SpeakerEmbedder",
    "cosine",
    "unit",
]
