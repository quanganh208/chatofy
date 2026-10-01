"""Quantize the float embedding tables a graph Gathers from, at a bounded peak.

Produces the same model `onnxruntime.quantization.quantize_dynamic(...,
weight_type=QInt8, per_channel=True, op_types_to_quantize=["Gather"])` does:
each float initializer read by a Gather becomes a UINT8 tensor with one scale
and zero point, and a DequantizeLinear restores the Gather's float output.
The initializers come out byte-identical and the outputs bit-identical, because
the numbers come from onnxruntime's own `quantize_data` / `quantize_nparray`.

What differs is memory. `quantize_dynamic` peaked at 5.8 GB on the 1.2 GB
Dewpoint graph — shape inference, a temp copy and the quantizer's own model
copies — and the deploy seeds weights inside a 7.5 GB Docker VM beside the
running sidecars, so it was OOM-killed. This path reads the table once,
quantizes it in row chunks and serializes a fresh model, peaking near 3 GB. It
also skips the shape-inferred value_info the quantizer adds, which onnxruntime
derives again at load.

Run as its own process by `download_models.py`, so that even an OOM kill here
costs only the optional restorer, never the seed.
Run: python scripts/quantize_embedding.py SOURCE.onnx DEST.onnx
"""
import gc
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper
from onnxruntime.quantization.quant_utils import quantize_data, quantize_nparray

# Rows quantized per step: 8192 × 768 floats is 24 MB of temporaries.
CHUNK_ROWS = 8192


def quantize_gather_tables(source: str, dest: str) -> int:
    """Rewrite `source` into `dest`; returns how many tables were quantized."""
    model = onnx.load(source)
    graph = model.graph
    initializers = {init.name: init for init in graph.initializer}
    nodes = []
    quantized = 0
    for node in graph.node:
        table = initializers.get(node.input[0]) if node.op_type == "Gather" else None
        if table is None or table.data_type != TensorProto.FLOAT or not table.raw_data:
            nodes.append(node)
            continue
        nodes.extend(_quantize_table(graph, node, table))
        quantized += 1
    del graph.node[:]
    graph.node.extend(nodes)
    # A fresh message, so the removed float tables leave with the old one's
    # arena before serializing — removing them alone frees nothing.
    fresh = onnx.ModelProto()
    fresh.CopyFrom(model)
    del model, graph, initializers, nodes
    gc.collect()
    with open(dest, "wb") as out:
        out.write(fresh.SerializeToString())
    return quantized


def _quantize_table(graph: onnx.GraphProto, node: onnx.NodeProto, table: onnx.TensorProto):
    """Swap `table` for its UINT8 form; returns the Gather and its DequantizeLinear."""
    dims = list(table.dims)
    raw = table.raw_data
    graph.initializer.remove(table)
    data = np.frombuffer(raw, dtype=np.float32).reshape(dims[0], -1)
    # `quantize_data` reads only the minimum and maximum, so it yields the
    # whole table's scale and zero point from these two values. Asymmetric
    # UINT8: a Gather's table is quantized as the quantizer's activation type.
    zero_point, scale, _ = quantize_data(
        np.array([data.min(), data.max()], dtype=np.float32),
        TensorProto.UINT8,
        False,
        reduce_range=False,
    )
    q = np.empty(data.shape, dtype=np.uint8)
    for start in range(0, data.shape[0], CHUNK_ROWS):
        rows = slice(start, start + CHUNK_ROWS)
        q[rows] = quantize_nparray(TensorProto.UINT8, data[rows], scale, zero_point)
    del data, raw

    # Names and shapes as the quantizer gives them, so the restorer sees the
    # graph it was measured on.
    q_name = table.name + "_quantized"
    zp_name = table.name + "_zero_point"
    scale_name = table.name + "_scale"
    graph.initializer.extend(
        [
            helper.make_tensor(scale_name, TensorProto.FLOAT, [], scale.reshape(-1).tolist()),
            helper.make_tensor(zp_name, TensorProto.UINT8, [], zero_point.reshape(-1).tolist()),
            helper.make_tensor(q_name, TensorProto.UINT8, dims, q.tobytes(), raw=True),
        ]
    )
    output = node.output[0]
    node.input[0] = q_name
    node.output[0] = output + "_quantized"
    dequantize = helper.make_node(
        "DequantizeLinear",
        [node.output[0], scale_name, zp_name],
        [output],
        output + "_DequantizeLinear",
    )
    return [node, dequantize]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: quantize_embedding.py SOURCE.onnx DEST.onnx")
    count = quantize_gather_tables(sys.argv[1], sys.argv[2])
    if count == 0:
        sys.exit("no float Gather table found to quantize")
