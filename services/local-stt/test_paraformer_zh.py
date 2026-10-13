"""The zh engine on real Mandarin speech, through the sidecar's own app.

Needs the Paraformer weights (scripts/download_models.py) and a FLEURS clip that
`benchmarks/stt/scripts/prepare_datasets_zh.py` fetches; skipped without them.
"""
import os
import re
from pathlib import Path

import pytest

from engines.base import MODELS_DIR
from engines.paraformer_zh import MODEL_DIR

FLEURS_CLIP = (
    Path(__file__).resolve().parent.parent.parent
    / "benchmarks/stt/data/audio/zh-fleurs/fleurs-cmn-1662-13372204995113843403.wav"
)

pytestmark = [
    pytest.mark.skipif(
        os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
        reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
    ),
    pytest.mark.skipif(
        not (MODEL_DIR / "model.int8.onnx").exists(),
        reason=f"{MODEL_DIR.relative_to(MODELS_DIR.parent)} missing; run scripts/download_models.py",
    ),
]

HAN = re.compile(r"[一-鿿]")


@pytest.mark.skipif(not FLEURS_CLIP.exists(), reason=f"{FLEURS_CLIP.name} missing")
def test_a_fleurs_clip_decodes_to_han_text_with_no_pauses(client):
    with open(FLEURS_CLIP, "rb") as f:
        res = client.post(
            "/transcribe",
            files={"file": ("clip.wav", f.read(), "audio/wav")},
            data={"language": "zh"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["language"] == "zh"
    # Recorded hypothesis for this clip in r11: 合金基本上由两种或以上金属混合而成…
    assert body["text"].startswith("合金基本上由两种")
    assert len(HAN.findall(body["text"])) > 20
    assert " " not in body["text"]
    # Pauses go to the restorer's language only; zh is not it.
    assert "pauses" not in body
    assert "leadPause" not in body


def test_the_zh_engine_loads_and_takes_no_hotwords(client):
    from app import registry

    engine = registry.get("zh")
    assert engine.loaded
    assert engine.supports_hotwords is False
