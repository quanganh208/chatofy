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
    #: A screen candidate is under evaluation and has not cleared the adoption
    #: bar. It is excluded from :data:`SHIPPING` for the same reason a baseline
    #: is: joining that set silently widens the smoke-test matrix and lets an
    #: unadopted model be asserted about as though it had been chosen.
    screen: bool = False
    #: Distribution terms, recorded here so they reach the CSV rather than
    #: living only in a docstring. This is the UPSTREAM PROJECT's licence; the
    #: weights are redistributed in the sherpa-onnx release and carry no
    #: separate licence file of their own, so a stricter term on the original
    #: ModelScope artifact would not be visible here.
    licence: str = "unrecorded"
    #: The training corpus, which is the axis Phase 5 is actually screening.
    corpus: str = "unrecorded"
    #: Pinned on first fetch, NOT an upstream-published checksum — the release
    #: publishes none. It guards against a corrupted download and against the
    #: bytes behind a stable URL changing later; it cannot attest provenance.
    sha256: str | None = None

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
        licence="Apache-2.0",
        corpus="3D-Speaker 200k zh-cn",
        sha256="bf1a75b9930474cf3389ef415e6e5d38ca96fea4a3a00f7e301d080a58ee2239",
    ),
    "campplus": ModelSpec(
        key="campplus",
        filename="3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        note="Challenger. The only explicitly bilingual (zh+en) model in the zoo; 2-4x cheaper.",
        dim=192,
        licence="Apache-2.0",
        corpus="3D-Speaker zh+en common (advanced)",
        sha256="aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    ),
    "wespeaker_en": ModelSpec(
        key="wespeaker_en",
        filename="wespeaker_en_voxceleb_CAM++.onnx",
        note="Baseline only. English VoxCeleb (~7k speakers); measured, not shipped.",
        dim=512,
        baseline=True,
        licence="Apache-2.0",
        corpus="VoxCeleb (English, ~7k speakers)",
        sha256="c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef",
    ),
    # --- Phase 5 screen candidates. Not shipping until they clear the bar. ---
    # The axis being screened is TRAINING CORPUS, not architecture: campplus and
    # wespeaker_en are both CAM++ and differ by 11.7 EER points here.
    "campplus_zh": ModelSpec(
        key="campplus_zh",
        filename="3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx",
        note="Screen. Same architecture and cost class as production's campplus, "
             "different corpus — isolates the corpus axis at zero latency risk.",
        dim=192,
        screen=True,
        licence="Apache-2.0",
        corpus="3D-Speaker zh-cn common (monolingual)",
        sha256="f682b514c05d947ee3fa91cd6ec6c5c7543479a128373fa29b1faedccd21fd11",
    ),
    "eres2net_base_200k": ModelSpec(
        key="eres2net_base_200k",
        filename="3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx",
        note="Screen. 200k-speaker training set; sits between campplus and "
             "eres2netv2 on size. Cost must be MEASURED, not extrapolated. "
             "512-dim, so like wespeaker_en it confounds dimension with corpus "
             "— it is not a clean controlled pair against the 192-dim models.",
        dim=512,
        screen=True,
        licence="Apache-2.0",
        corpus="3D-Speaker 200k zh-cn",
        sha256="e2d2048292e055f7b61cdec3db010503f35369b245bf0b3bbad021c9a91e4053",
    ),
    "wespeaker_zh_cnceleb": ModelSpec(
        key="wespeaker_zh_cnceleb",
        filename="wespeaker_zh_cnceleb_resnet34_LM.onnx",
        note="Screen. CN-Celeb is multi-genre and tonal — the closest available "
             "domain analogue to VoxVietnam's in-the-wild content. The only "
             "genuine hypothesis in the set.",
        dim=256,
        screen=True,
        licence="Apache-2.0",
        corpus="CN-Celeb (Mandarin, multi-genre)",
        sha256="87d1d5068397f3792c730570b53d66cd8be1da7ea22dd04f5b6706d96a3cd168",
    ),
}

#: Phase 5's screen set, kept apart from both SHIPPING and the baseline.
SCREEN = {key: spec for key, spec in CANDIDATES.items() if spec.screen}


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
SHIPPING = {
    key: spec
    for key, spec in CANDIDATES.items()
    if not spec.baseline and not spec.screen
}

__all__ = [
    "CANDIDATES",
    "MODELS_DIR",
    "SCREEN",
    "SHIPPING",
    "ModelSpec",
    "SpeakerEmbedder",
    "cosine",
    "unit",
]
