"""The encoder-head arm's leave-one-corpus-out bookkeeping."""

import importlib.util
from pathlib import Path

import numpy as np

from lid_bench.manifest import Turn, opaque_id

spec = importlib.util.spec_from_file_location(
    "whisper_head_train", Path(__file__).resolve().parents[1] / "arms" / "whisper_head" / "train.py")
train = importlib.util.module_from_spec(spec)
spec.loader.exec_module(train)


def turn(tid, group):
    return Turn(id=tid, audio="x.wav", lang="zh", bucket="<1.5", speech_ms=800, channel="laptop", group=group,
                source=group, real=True, license="x")


def test_a_rerecorded_copy_is_held_out_with_the_corpus_it_was_played_from():
    original = turn("a1", "ascend")
    copy = turn(opaque_id("rerecorded", "a1"), "rerecorded")
    groups = train.corpus_groups([original, copy, turn("e1", "edacc")])
    assert groups == {"a1": "ascend", copy.id: "ascend", "e1": "edacc"}


def test_probabilities_land_in_the_column_of_their_language_whatever_the_model_order():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(60, 4))
    y = np.array(["zh", "vi", "en"] * 20)
    X[y == "zh", 0] += 5
    probs = train.predict(train.fit(X, y), X)
    assert probs.shape == (60, len(train.CLASSES))
    assert np.allclose(probs.sum(axis=1), 1)
    assert (probs[y == "zh"].argmax(axis=1) == train.CLASSES.index("zh")).all()
