import json

import numpy as np

from lid_bench.manifest import Turn, save
from lid_bench.run_data import load_run, mask


def write_run(tmp_path, n=30):
    rng = np.random.default_rng(0)
    turns, rows = [], []
    for i in range(n):
        lang = ("vi", "en", "zh")[i % 3]
        group = ("a", "b", "c")[(i // 3) % 3]
        turns.append(Turn(id=f"t{i}", audio="x.wav", lang=lang, bucket="3-8", speech_ms=4000, channel="read",
                          group=group, source="fleurs", real=False, license="x"))
        feats = {}
        for engine in ("vi", "en", "zh"):
            conf = -0.05 if engine == lang else -0.8
            feats[engine] = {"empty": 0.0, "mean_logp": conf + rng.normal(scale=0.05), "min_logp": conf * 3,
                             "tokens_per_s": 4.0, "script": 1.0 if engine == lang else 0.0}
        engine_ms = {"vi": 60.0, "en": 300.0, "zh": 120.0}
        rows.append({"id": f"t{i}", "prefix_ms": None, "speech_ms": 4000, "features": feats, "engine_ms": engine_ms})
        rows.append({"id": f"t{i}", "prefix_ms": 900, "speech_ms": 700, "features": feats, "engine_ms": engine_ms})
    save(tmp_path / "manifest.jsonl", turns)
    (tmp_path / "rc.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (tmp_path / "rc.meta.json").write_text(json.dumps({"arm": "rc", "kind": "recognizer",
                                                       "runtime": "onnxruntime-1.27.0", "new_model": False}))
    model_rows = [{"id": f"t{i}", "prefix_ms": None, "speech_ms": 4000, "latency_ms": 5.0,
                   "probs": {"en+vi+zh": {"vi": 0.6, "en": 0.3, "zh": 0.1}}} for i in range(n)]
    (tmp_path / "lid.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in model_rows))
    (tmp_path / "lid.meta.json").write_text(json.dumps({"arm": "lid", "kind": "lid-model",
                                                        "runtime": "onnxruntime-1.27.0"}))


def test_feature_arm_gets_out_of_fold_probs_and_one_model_per_set(tmp_path):
    write_run(tmp_path)
    turns, _, arms = load_run(tmp_path)
    rc = arms["rc"]
    assert rc.cv_scheme == "logo"
    assert set(rc.models) == {f"{stage}:{k}" for stage in ("final", "partial")
                              for k in ("en+vi", "vi+zh", "en+zh", "en+vi+zh")}
    correct = sum(max(rc.full(t.id, ("en", "vi", "zh")).items(), key=lambda kv: kv[1])[0] == t.lang for t in turns)
    assert correct == len(turns)  # separable synthetic data, held out per group
    assert [p.ms for p in rc.prefixes("t0", ("en", "vi"))] == [900]
    # Arm 4's latency for a set is its slowest engine.
    assert rc.latency[("t0", None)]["en+vi"] == 300.0


def test_model_arm_masks_its_triple_for_a_pair(tmp_path):
    write_run(tmp_path)
    _, _, arms = load_run(tmp_path)
    pair = arms["lid"].full("t0", ("en", "vi"))
    assert pair == mask({"vi": 0.6, "en": 0.3, "zh": 0.1}, ("en", "vi"))
    assert abs(pair["vi"] - 2 / 3) < 1e-9


def test_fused_arm_adds_lid_features_and_waits_for_the_lid_model(tmp_path):
    write_run(tmp_path)
    rows = [json.loads(line) for line in (tmp_path / "rc.scores.jsonl").read_text().splitlines()]
    for row in rows:
        for values in row["features"].values():
            values["lid_logp"] = -0.5
        row["engine_ms"]["lid"] = 400.0
    (tmp_path / "rc.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    _, _, arms = load_run(tmp_path)
    rc = arms["rc"]
    assert "vi.lid_logp" in rc.models["final:en+vi"]["features"]
    assert "d.lid_logp.vi-en" in rc.models["final:en+vi"]["features"]
    # Slower than either engine, so the LID model is what the decision waits for.
    assert rc.latency[("t0", None)]["en+vi"] == 400.0
