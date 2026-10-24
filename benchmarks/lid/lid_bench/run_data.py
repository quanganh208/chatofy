"""Load one run directory into lookups the scorer can ask questions of.

An arm writes one of two shapes per row (`<arm>.scores.jsonl`):

- `probs`: `{set_key: {lang: p}}` -- a model that answers directly (arms 1-3,
  and the Scribe ceiling). A set it did not answer for is derived by masking
  its triple to the candidates and renormalising, which is exactly what the
  sidecar would do with a 3-way LID model and a declared pair.
- `features` + `engine_ms`: arm 4, and arm 4 fused with a LID model (its
  features then carry `lid_logp`, its `engine_ms` a `lid` entry). Their probabilities are produced HERE, out of
  fold (lid_bench.classifier), one model per candidate set, and the all-data
  models are exported as the artifact Phase 1 would load.

Rows with `prefix_ms: null` are the whole turn; others are prefixes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from lid_bench import classifier, features
from lid_bench.gate import ArmInfo
from lid_bench.manifest import LANGUAGES, Turn, load
from lid_bench.runtime_policy import Prefix

FULL_KEY = "+".join(sorted(LANGUAGES))
#: `engine_ms` key a fused arm uses for its LID model's latency.
LID_ENGINE = "lid"


def set_key(candidates: tuple[str, ...]) -> str:
    return "+".join(sorted(candidates))


def mask(probs: dict[str, float], candidates: tuple[str, ...]) -> dict[str, float]:
    total = sum(probs.get(c, 0.0) for c in candidates)
    if total <= 0:
        return {c: 1.0 / len(candidates) for c in candidates}
    return {c: probs.get(c, 0.0) / total for c in candidates}


@dataclass
class ArmData:
    info: ArmInfo
    #: (turn id, prefix_ms or None) -> {set_key: probs}
    probs: dict[tuple[str, int | None], dict[str, dict[str, float]]] = field(default_factory=dict)
    #: (turn id, prefix_ms or None) -> latency in ms per candidate set
    latency: dict[tuple[str, int | None], dict[str, float]] = field(default_factory=dict)
    speech_ms: dict[tuple[str, int | None], int] = field(default_factory=dict)
    engine_ms: dict[str, dict[str, float]] = field(default_factory=dict)
    models: dict[str, dict] = field(default_factory=dict)
    cv_scheme: str | None = None
    _prefix_index: dict[str, list[int]] | None = field(default=None, repr=False)

    def full(self, turn_id: str, candidates: tuple[str, ...]) -> dict[str, float]:
        return self._lookup((turn_id, None), candidates)

    def _lookup(self, key: tuple[str, int | None], candidates: tuple[str, ...]) -> dict[str, float]:
        answers = self.probs[key]
        exact = answers.get(set_key(candidates))
        return dict(exact) if exact is not None else mask(answers[FULL_KEY], candidates)

    def prefixes(self, turn_id: str, candidates: tuple[str, ...]) -> list[Prefix]:
        if self._prefix_index is None:
            index: dict[str, list[int]] = {}
            for tid, ms in self.probs:
                if ms is not None:
                    index.setdefault(tid, []).append(ms)
            self._prefix_index = {tid: sorted(v) for tid, v in index.items()}
        rows = self._prefix_index.get(turn_id, [])
        return [
            Prefix(ms=ms, speech_ms=self.speech_ms.get((turn_id, ms), ms),
                   probs=self._lookup((turn_id, ms), candidates),
                   latency_ms=self.latency.get((turn_id, ms), {}).get(set_key(candidates), 0.0))
            for ms in rows
        ]


def load_facts(run_dir: Path) -> dict[str, dict]:
    path = run_dir / "facts.jsonl"
    if not path.exists():
        return {}
    return {row["id"]: row for row in map(json.loads, path.read_text().splitlines())}


def load_arm(run_dir: Path, arm: str, turns: list[Turn]) -> ArmData:
    meta = json.loads((run_dir / f"{arm}.meta.json").read_text())
    parity_path = run_dir / f"{arm}.parity.json"
    if parity_path.exists():
        meta["parity_passed"] = json.loads(parity_path.read_text())["passed"]
    info = ArmInfo(**{k: meta[k] for k in ArmInfo.__dataclass_fields__ if k in meta})
    rows = [json.loads(line) for line in (run_dir / f"{arm}.scores.jsonl").read_text().splitlines()]
    # A model arm whose probabilities are out of fold says how it validated them.
    data = ArmData(info=info, cv_scheme=meta.get("cv"))
    for row in rows:
        key = (row["id"], row["prefix_ms"])
        data.speech_ms[key] = row.get("speech_ms", 0)
        if "probs" in row:
            data.probs[key] = row["probs"]
            latency = row.get("latency_ms", 0.0)
            # A routed arm answers each set with a different model: per-set latency.
            data.latency[key] = (dict(latency) if isinstance(latency, dict)
                                 else {set_key(c): latency for c in _all_sets()})
    if any("features" in row for row in rows):
        _materialise_features(data, rows, {t.id: t for t in turns})
    return data


def set_latency(engine_ms: dict[str, float], candidates: tuple[str, ...]) -> float:
    """The decision is ready when the slowest candidate engine is -- and, for a
    fused arm, the LID model, which runs beside the decodes on the same audio."""
    return max([engine_ms[lang] for lang in candidates] + [engine_ms.get(LID_ENGINE, 0.0)])


def _all_sets() -> list[tuple[str, ...]]:
    return list(classifier.SUBSETS)


def _materialise_features(data: ArmData, rows: list[dict], turns: dict[str, Turn]) -> None:
    rows = [r for r in rows if r["id"] in turns]
    for row in rows:
        key = (row["id"], row["prefix_ms"])
        data.latency[key] = {set_key(c): set_latency(row["engine_ms"], c) for c in classifier.SUBSETS}
        if row["prefix_ms"] is None:
            data.engine_ms[row["id"]] = row["engine_ms"]
    schemes = set()
    # Two models per candidate set: one for finals, trained on whole turns,
    # and one for partials, trained on prefixes. One model for both was
    # measured to be overconfident on short audio (0.86 mean confidence at
    # 600 ms for 0.50 accuracy) and, trained on both, cost the finals accuracy.
    for stage, is_stage in (("final", lambda r: r["prefix_ms"] is None),
                            ("partial", lambda r: r["prefix_ms"] is not None)):
        staged = [r for r in rows if is_stage(r)]
        if not staged:
            continue
        for subset in classifier.SUBSETS:
            cands = tuple(sorted(subset))
            names = features.feature_names(cands, features.has_lid(staged[0]["features"]))
            train = [r for r in staged if turns[r["id"]].lang in cands]
            X = np.array([features.vector(r["features"], cands) for r in train])
            y = np.array([turns[r["id"]].lang for r in train])
            g = np.array([turns[r["id"]].group for r in train])
            units = np.array([r["id"] for r in train])
            apply = [r for r in staged if turns[r["id"]].lang not in cands]
            Xa = np.array([features.vector(r["features"], cands) for r in apply]) if apply else None
            ga = np.array([turns[r["id"]].group for r in apply]) if apply else None
            oof, applied, scheme = classifier.out_of_fold(X, y, g, cands, Xa, ga, units)
            schemes.add(scheme)
            for r, p in zip(train, oof):
                data.probs.setdefault((r["id"], r["prefix_ms"]), {})[set_key(cands)] = dict(zip(cands, p.tolist()))
            for r, p in zip(apply, applied if applied is not None else []):
                data.probs.setdefault((r["id"], r["prefix_ms"]), {})[set_key(cands)] = dict(zip(cands, p.tolist()))
            data.models[f"{stage}:{set_key(cands)}"] = classifier.fit_export(X, y, names, cands)
    data.cv_scheme = ",".join(sorted(schemes))


def load_run(run_dir: Path) -> tuple[list[Turn], dict[str, dict], dict[str, ArmData]]:
    turns = load(run_dir / "manifest.jsonl")
    arms = {
        path.name.removesuffix(".meta.json"): load_arm(run_dir, path.name.removesuffix(".meta.json"), turns)
        for path in sorted(run_dir.glob("*.meta.json"))
    }
    return turns, load_facts(run_dir), arms
