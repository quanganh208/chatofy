"""A Whisper ONNX encoder that encodes only the turn, not a 30 s window.

Whisper always encodes 3000 mel frames: a 2 s turn pays for 30 s. whisper.cpp
skips that with `audio_ctx`, and the same works on the exported graph. The
convolutions and attention already take any length (their shapes are read at
run time). The one thing fixed at 1500 positions is the positional embedding,
added once after the convolutions (`embed_positions.weight`, [1500, d]). This
rewrites that Add to use the first T rows, T being the conv output's time
length, and marks the output's time axis dynamic. Nothing else changes, so a
3000-frame input gives the original encoder's output exactly (checked over 100
clips when the arm was measured, and by `test_lid.py`).

Applied in memory at load rather than written beside the pinned weights: the
runtime mounts models read-only, and a derived file would be one more thing a
cache check has to trust.
"""
import onnx
from onnx import TensorProto, helper

POSITIONS = "embed_positions.weight"


def window(model: onnx.ModelProto) -> onnx.ModelProto:
    graph = model.graph
    adds = [n for n in graph.node if n.op_type == "Add" and POSITIONS in n.input]
    if len(adds) != 1:
        raise ValueError(f"expected one Add over {POSITIONS}, found {len(adds)}")
    add = adds[0]
    hidden = next(x for x in add.input if x != POSITIONS)  # [batch, T, d]
    sliced = f"{POSITIONS}/window"
    nodes = [
        # Shape + Gather rather than Shape(start=1): the export's opset may predate it.
        helper.make_node("Shape", [hidden], [f"{sliced}/shape"]),
        helper.make_node("Constant", [], [f"{sliced}/one"],
                         value=helper.make_tensor("one", TensorProto.INT64, [1], [1])),
        helper.make_node("Gather", [f"{sliced}/shape", f"{sliced}/one"], [f"{sliced}/length"], axis=0),
        helper.make_node("Constant", [], [f"{sliced}/zero"],
                         value=helper.make_tensor("zero", TensorProto.INT64, [1], [0])),
        helper.make_node("Slice", [POSITIONS, f"{sliced}/zero", f"{sliced}/length", f"{sliced}/zero"], [sliced]),
    ]
    add.input[list(add.input).index(POSITIONS)] = sliced
    index = list(graph.node).index(add)
    for offset, node in enumerate(nodes):
        graph.node.insert(index + offset, node)
    for output in graph.output:
        dims = output.type.tensor_type.shape.dim
        if len(dims) == 3 and dims[1].dim_value == 1500:
            dims[1].ClearField("dim_value")
            dims[1].dim_param = "encoder_positions"
    onnx.checker.check_model(model)
    return model
