"""The recorded model dimensions must match the loaded models.

Cheap tripwire: `ModelSpec.dim` is used for reporting, and a re-download that
quietly swapped a model would otherwise go unnoticed until a bench produced
numbers nobody could explain.
"""

from __future__ import annotations

import pytest

from speaker_bench.embed import CANDIDATES, SpeakerEmbedder

AVAILABLE = [spec for spec in CANDIDATES.values() if spec.path.exists()]

pytestmark = pytest.mark.skipif(not AVAILABLE, reason="run scripts/download_models.py first")


@pytest.mark.parametrize("spec", AVAILABLE, ids=lambda s: s.key)
def test_recorded_dim_matches_loaded_model(spec) -> None:
    assert spec.dim is not None, f"{spec.key}: dimension not recorded"
    assert SpeakerEmbedder(spec).dim == spec.dim
