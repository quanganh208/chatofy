import json

import numpy as np
import soundfile as sf

from lid_bench import arm_io
from lid_bench.manifest import Turn, save


def setup(tmp_path, monkeypatch, n=3):
    monkeypatch.setattr(arm_io, "BENCH_ROOT", tmp_path)
    sf.write(tmp_path / "x.wav", np.zeros(16000 * 2, dtype=np.float32), 16000)
    turns = [Turn(id=f"t{i}", audio="x.wav", lang="vi", bucket="1.5-3", speech_ms=2000, channel="read",
                  group="g", source="fleurs", real=False, license="x") for i in range(n)]
    save(tmp_path / "m.jsonl", turns)
    return tmp_path / "m.jsonl", tmp_path / "out"


def test_an_interrupted_run_resumes_without_redoing_finished_turns(tmp_path, monkeypatch):
    manifest, out = setup(tmp_path, monkeypatch)
    out.mkdir()
    done = {"id": "t0", "prefix_ms": None, "speech_ms": 0, "probs": {"en+vi+zh": {"vi": 1.0, "en": 0.0, "zh": 0.0}},
            "latency_ms": 1.0}
    # t0 finished; t1's write was torn by the kill.
    (out / "a.scores.partial.jsonl").write_text(json.dumps(done) + "\n" + '{"id": "t1", "pre')
    calls = []

    def probs(clip):
        calls.append(len(clip))
        return {"vi": 0.5, "en": 0.5, "zh": 0.0}

    arm_io.run("a", probs, manifest, out, [600], {}, 0.0)
    rows = [json.loads(line) for line in (out / "a.scores.jsonl").read_text().splitlines()]
    assert [r["id"] for r in rows if r["prefix_ms"] is None] == ["t0", "t1", "t2"]
    assert len(calls) == 4  # t1 and t2, each the full turn plus one prefix
    assert not (out / "a.scores.partial.jsonl").exists()
    assert "resumed after 1 turns" in json.loads((out / "a.meta.json").read_text())["notes"]
