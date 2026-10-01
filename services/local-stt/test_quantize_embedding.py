"""The seed's embedding quantizer, against the onnxruntime quantizer it replaces.

The restorer was measured on what `quantize_dynamic` produced, so the
low-memory path is held to that exactly: the same initializers byte for byte,
the same nodes, and bit-identical outputs. A small synthetic graph stands in
for the 1.2 GB Dewpoint one — the same shape of problem (a float table read by
a Gather, then ordinary float ops) at test speed.
"""
import subprocess

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

from scripts.quantize_embedding import quantize_gather_tables


def _embedding_model(path):
    rng = np.random.default_rng(7)
    # Skewed and off-centre, so a symmetric or per-channel scheme would differ.
    table = (rng.standard_normal((300, 16)) * 0.4 + 0.15).astype(np.float32)
    bias = rng.standard_normal(16).astype(np.float32)
    graph = helper.make_graph(
        [
            helper.make_node("Gather", ["table", "ids"], ["embedded"], "/embed/Gather"),
            helper.make_node("Add", ["embedded", "bias"], ["out"], "/embed/Add"),
        ],
        "embedding",
        [helper.make_tensor_value_info("ids", TensorProto.INT64, ["batch", "seq"])],
        [helper.make_tensor_value_info("out", TensorProto.FLOAT, ["batch", "seq", 16])],
        [numpy_helper.from_array(table, "table"), numpy_helper.from_array(bias, "bias")],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.save(model, path)


def _quantized_both_ways(tmp_path):
    source = tmp_path / "source.onnx"
    _embedding_model(source)
    reference, ours = tmp_path / "reference.onnx", tmp_path / "ours.onnx"
    quantize_dynamic(
        str(source),
        str(reference),
        weight_type=QuantType.QInt8,
        per_channel=True,
        op_types_to_quantize=["Gather"],
    )
    assert quantize_gather_tables(str(source), str(ours)) == 1
    return onnx.load(reference), onnx.load(ours), reference, ours


def test_matches_the_onnxruntime_quantizer_byte_for_byte(tmp_path):
    reference, ours, _, _ = _quantized_both_ways(tmp_path)

    def initializers(model):
        return {i.name: i.SerializeToString() for i in model.graph.initializer}

    def nodes(model):
        return sorted(n.SerializeToString() for n in model.graph.node)

    assert initializers(ours) == initializers(reference)
    assert nodes(ours) == nodes(reference)
    onnx.checker.check_model(ours)


def test_answers_bit_identically_to_the_onnxruntime_quantizer(tmp_path):
    _, _, reference, ours = _quantized_both_ways(tmp_path)
    ids = np.random.default_rng(3).integers(0, 300, size=(2, 40), dtype=np.int64)

    def run(path):
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        return session.run(None, {"ids": ids})[0]

    assert np.array_equal(run(ours), run(reference))


def test_a_killed_quantizer_skips_the_restorer_without_failing_the_seed(monkeypatch, tmp_path, capsys):
    # An OOM kill is a SIGKILL: no `except` in the seed would see it, so the
    # quantizer runs as a child and its exit status is all the seed reads.
    import scripts.download_models as seed

    out_dir = tmp_path / "dewpoint-mmbert-base"
    for filename in seed.DEWPOINT_FILES:
        (out_dir / filename).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / filename).write_text("{}")
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(seed, "hf_hub_download", lambda *a, **k: str(tmp_path / "source.onnx"))

    def killed(command, check):
        (out_dir / seed.DEWPOINT_ONNX).with_suffix(".part").write_bytes(b"half")
        return subprocess.CompletedProcess(command, -9)

    monkeypatch.setattr(seed.subprocess, "run", killed)

    seed.fetch_dewpoint()

    target = out_dir / seed.DEWPOINT_ONNX
    assert "skipped" in capsys.readouterr().out
    assert not target.exists()
    assert not target.with_suffix(".part").exists()
