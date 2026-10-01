"""Quantize the float embedding tables a graph Gathers from, without loading it.

Produces the same model `onnxruntime.quantization.quantize_dynamic(...,
weight_type=QInt8, per_channel=True, op_types_to_quantize=["Gather"])` does:
each float initializer read by a Gather becomes a UINT8 tensor with one scale
and zero point, and a DequantizeLinear restores the Gather's float output.
The initializers come out byte-identical and the outputs bit-identical, because
the numbers come from onnxruntime's own `quantize_data` / `quantize_nparray`.

What differs is memory, which is the whole point. The deploy seeds weights in
a 7.5 GB Docker VM beside the running sidecars, with about 3.4 GB free.
`quantize_dynamic` peaked at 5.8 GB on the 1.2 GB Dewpoint graph, and even a
version that loaded the graph with `onnx.load` and quantized in chunks peaked
near 3 GB — protobuf holds the file and the parsed message at once, then
serializes through more copies — and was killed there too.

So the graph is never parsed whole. The file is memory-mapped and walked at the
protobuf wire level: every field but the quantized tables and their Gathers is
copied through byte for byte, only node messages are parsed (they are small),
and each table is quantized in row chunks straight from the mapped pages.
Protobuf merges a repeated field wherever it appears, so the new initializers
are appended at the end of the graph.

Run as its own process by `download_models.py`, so that even an OOM kill here
costs only the optional restorer, never the seed.
Run: python scripts/quantize_embedding.py SOURCE.onnx DEST.onnx
"""
import mmap
import sys
from dataclasses import dataclass

import numpy as np
from onnx import NodeProto, TensorProto, helper
from onnxruntime.quantization.quant_utils import quantize_data, quantize_nparray

# Field numbers from onnx.proto.
MODEL_GRAPH = 7
GRAPH_NODE = 1
GRAPH_INITIALIZER = 5
TENSOR_DIMS = 1
TENSOR_DATA_TYPE = 2
TENSOR_NAME = 8
TENSOR_RAW_DATA = 9
TENSOR_EXTERNAL_DATA = 13
TENSOR_DATA_LOCATION = 14

LENGTH_DELIMITED = 2

# Rows quantized per step: 8192 × 768 floats is 24 MB of temporaries.
CHUNK_ROWS = 8192


@dataclass
class _Table:
    """A float initializer's header, with where its raw bytes sit in the file."""

    name: str
    dims: list[int]
    raw: tuple[int, int]


def quantize_gather_tables(source: str, dest: str) -> int:
    """Rewrite `source` into `dest`; returns how many tables were quantized."""
    with open(source, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as buf:
        graph = next(
            ((start, end) for number, _, _, start, end in _fields(buf, 0, len(buf)) if number == MODEL_GRAPH),
            None,
        )
        if graph is None:
            raise ValueError(f"{source} holds no graph")
        tables, table_fields, nodes = _scan_graph(buf, *graph)
        gathers = {at: node for at, node in nodes.items() if node.op_type == "Gather" and node.input[0] in tables}
        targets = {node.input[0] for node in gathers.values()}
        for node in nodes.values():
            if node.op_type != "Gather" and targets.intersection(node.input):
                raise ValueError(f"{node.name} reads a table that would be quantized")

        quantized = {name: _quantize_table(buf, tables[name]) for name in sorted(targets)}
        graph_plan = []
        for number, _, field_start, _, end in _fields(buf, *graph):
            if number == GRAPH_INITIALIZER and table_fields.get(field_start) in targets:
                continue
            if number == GRAPH_NODE and field_start in gathers:
                for rewritten in _gather_with_dequantize(gathers[field_start]):
                    graph_plan.append(_field(GRAPH_NODE, rewritten.SerializeToString()))
                continue
            graph_plan.append((field_start, end))
        for name, (scale, zero_point, q) in quantized.items():
            graph_plan.extend(_quantized_initializers(tables[name], scale, zero_point, q))

        graph_size = sum(_size(piece) for piece in graph_plan)
        with open(dest, "wb") as out:
            for number, _, field_start, _, end in _fields(buf, 0, len(buf)):
                if number != MODEL_GRAPH:
                    out.write(buf[field_start:end])
                    continue
                out.write(_key_and_length(MODEL_GRAPH, graph_size))
                for piece in graph_plan:
                    out.write(buf[piece[0] : piece[1]] if isinstance(piece, tuple) else piece)
        return len(quantized)


def _scan_graph(buf, start: int, end: int):
    """Float tables by name, which initializer field holds each, and every node by field offset."""
    tables: dict[str, _Table] = {}
    table_fields: dict[int, str] = {}
    nodes: dict[int, NodeProto] = {}
    for number, _, field_start, value_start, value_end in _fields(buf, start, end):
        if number == GRAPH_NODE:
            nodes[field_start] = NodeProto.FromString(buf[value_start:value_end])
        elif number == GRAPH_INITIALIZER:
            table = _float_table(buf, value_start, value_end)
            if table is not None:
                tables[table.name] = table
                table_fields[field_start] = table.name
    return tables, table_fields, nodes


def _float_table(buf, start: int, end: int):
    """The header of a FLOAT initializer held inline as raw bytes; None for any other."""
    name, data_type, dims, raw, external = "", 0, [], None, False
    for number, wire, _, value_start, value_end in _fields(buf, start, end):
        if number == TENSOR_NAME:
            name = buf[value_start:value_end].decode()
        elif number == TENSOR_DATA_TYPE:
            data_type = _varint(buf, value_start)[0]
        elif number == TENSOR_DIMS:
            if wire == LENGTH_DELIMITED:
                at = value_start
                while at < value_end:
                    dim, at = _varint(buf, at)
                    dims.append(dim)
            else:
                dims.append(_varint(buf, value_start)[0])
        elif number == TENSOR_RAW_DATA:
            raw = (value_start, value_end)
        elif number == TENSOR_EXTERNAL_DATA or (
            number == TENSOR_DATA_LOCATION and _varint(buf, value_start)[0] != 0
        ):
            external = True
    if data_type != TensorProto.FLOAT or raw is None or external or len(dims) < 1:
        return None
    return _Table(name, dims, raw)


def _quantize_table(buf, table: _Table):
    """The table's scale, zero point and UINT8 values, read from the mapped file."""
    start, end = table.raw
    data = np.frombuffer(buf, dtype=np.float32, count=(end - start) // 4, offset=start)
    data = data.reshape(table.dims[0], -1)
    try:
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
        for row in range(0, data.shape[0], CHUNK_ROWS):
            rows = slice(row, row + CHUNK_ROWS)
            q[rows] = quantize_nparray(TensorProto.UINT8, data[rows], scale, zero_point)
    finally:
        # The array exports the map's buffer; the map cannot close while it lives.
        del data
    return scale, zero_point, q


def _gather_with_dequantize(node: NodeProto) -> list[NodeProto]:
    """The Gather reading the quantized table, and the DequantizeLinear after it.

    Names as the quantizer gives them, so the restorer sees the graph it was
    measured on.
    """
    table, output = node.input[0], node.output[0]
    gather = NodeProto()
    gather.CopyFrom(node)
    gather.input[0] = table + "_quantized"
    gather.output[0] = output + "_quantized"
    dequantize = helper.make_node(
        "DequantizeLinear",
        [gather.output[0], table + "_scale", table + "_zero_point"],
        [output],
        output + "_DequantizeLinear",
    )
    return [gather, dequantize]


def _quantized_initializers(table: _Table, scale, zero_point, q) -> list[bytes]:
    """The scale, zero point and UINT8 table as graph initializer fields.

    The table's raw bytes are written from the array itself, never copied into
    a protobuf message.
    """
    scale_tensor = helper.make_tensor(table.name + "_scale", TensorProto.FLOAT, [], scale.reshape(-1).tolist())
    zero_tensor = helper.make_tensor(
        table.name + "_zero_point", TensorProto.UINT8, [], zero_point.reshape(-1).tolist()
    )
    header = TensorProto(name=table.name + "_quantized", data_type=TensorProto.UINT8, dims=table.dims)
    head = header.SerializeToString() + _key_and_length(TENSOR_RAW_DATA, q.nbytes)
    return [
        _field(GRAPH_INITIALIZER, scale_tensor.SerializeToString()),
        _field(GRAPH_INITIALIZER, zero_tensor.SerializeToString()),
        _key_and_length(GRAPH_INITIALIZER, len(head) + q.nbytes) + head,
        memoryview(q).cast("B"),
    ]


def _fields(buf, start: int, end: int):
    """Each field of the message in `buf[start:end]`: (number, wire type, field start, value start, value end)."""
    at = start
    while at < end:
        field_start = at
        key, at = _varint(buf, at)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value_start, (_, at) = at, _varint(buf, at)
        elif wire == 1:
            value_start, at = at, at + 8
        elif wire == LENGTH_DELIMITED:
            length, value_start = _varint(buf, at)
            at = value_start + length
        elif wire == 5:
            value_start, at = at, at + 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire} at byte {field_start}")
        yield number, wire, field_start, value_start, at


def _varint(buf, at: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, at
        shift += 7


def _encode_varint(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _key_and_length(number: int, length: int) -> bytes:
    return _encode_varint((number << 3) | LENGTH_DELIMITED) + _encode_varint(length)


def _field(number: int, payload: bytes) -> bytes:
    return _key_and_length(number, len(payload)) + payload


def _size(piece) -> int:
    return piece[1] - piece[0] if isinstance(piece, tuple) else len(piece) if isinstance(piece, bytes) else piece.nbytes


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: quantize_embedding.py SOURCE.onnx DEST.onnx")
    count = quantize_gather_tables(sys.argv[1], sys.argv[2])
    if count == 0:
        sys.exit("no float Gather table found to quantize")
