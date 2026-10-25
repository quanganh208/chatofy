"""Length-gated fusion of two recorded arms."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("fuse_scores",
                                              Path(__file__).resolve().parents[1] / "scripts" / "fuse_scores.py")
fuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fuse)


def row(speech_ms, probs, latency=100.0):
    return {"id": "t", "prefix_ms": None, "speech_ms": speech_ms, "probs": {"en+vi+zh": probs}, "latency_ms": latency}


A = {"vi": 0.6, "en": 0.3, "zh": 0.1}
B = {"vi": 0.1, "en": 0.2, "zh": 0.7}


def test_a_long_turn_keeps_the_first_arm_untouched():
    a = row(2000, A)
    assert fuse.fuse_row(a, row(2000, B, 30.0), 1500, (1.0, 1.0), None) is a


def test_a_short_turn_is_the_normalised_product_at_equal_share_and_pays_both_latencies():
    out = fuse.fuse_row(row(900, A), row(900, B, 30.0), 1500, (1.0, 1.0), None)
    product = {k: A[k] * B[k] for k in A}
    total = sum(product.values())
    assert all(abs(out["probs"]["en+vi+zh"][k] - product[k] / total) < 1e-12 for k in A)
    assert out["latency_ms"] == 130.0


def test_a_turn_the_second_arm_never_scored_falls_back_to_the_first():
    a = row(900, A)
    assert fuse.fuse_row(a, None, 1500, (1.0, 1.0), None) is a


def test_the_vi_en_pair_gets_its_own_share_and_the_zh_sets_keep_theirs():
    out = fuse.fuse_row(row(900, A), row(900, B), 1500, (1.0, 1.0), (1.0, 0.0))
    assert set(out["probs"]) == {"en+vi+zh", "en+vi"}
    assert abs(out["probs"]["en+vi"]["vi"] - 0.6 / 0.9) < 1e-12  # exponent 0: the first arm alone
    assert out["probs"]["en+vi+zh"]["zh"] > A["zh"]
