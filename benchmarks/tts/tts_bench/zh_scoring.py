"""Score a zh run: round-trip CER per judge, speed, RSS, voice choice, decision,
and the en regression verdict for the shared v1_0 instance.

Decision rule (plan.md, fixed before the run): reusing v1_0 wins unless
v1_1's round-trip CER is lower by more than 2 points under BOTH judges.
An arm's CER is the corpus CER over its chosen female + male voice. The voice
chosen per gender is the one with the lowest CER averaged over the two judges;
the same selection is applied to both arms, and the all-voice CER is reported
next to it so the choice can be seen not to drive the verdict.

en regression rule: byte-identical, or p95 within ±10% and round-trip WER not
worse. Kokoro is not deterministic run to run, so the en-only config is run
twice and "not worse" is read against that run-to-run control.
"""

import json
from collections import defaultdict
from pathlib import Path

from .measure import latency_stats, load_sentences
from .text_metrics import (
    corpus_error_rate,
    normalize_en,
    sentence_error_rate,
    tokenize_zh,
)

ZH_JUDGES = ("sensevoice-zh", "paraformer-zh")
EN_JUDGE = "parakeet-en"
V1_0, V1_1 = "kokoro-v1_0-en-zh", "kokoro-v1_1-int8-zh"
DECISION_MARGIN_POINTS = 2.0
P95_TOLERANCE = 0.10


def load_run(path: Path) -> dict:
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    header, rows = lines[0], [r for r in lines[1:] if r.get("type") == "sentence"]
    if header.get("type") != "header" or not rows:
        raise ValueError(f"{path}: malformed run file")
    proc = [r["proc_s"] for r in rows]
    audio = sum(r["audio_s"] for r in rows)
    return {
        "engine": header["engine"], "params": header["decode_params"],
        "load_s": header["load_s"], "peak_rss_mb": header["peak_rss_mb"],
        "latency": latency_stats(proc), "rtf": sum(proc) / audio,
        "rows": {r["sentence_id"]: r for r in rows},
    }


def load_hyps(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        if rec.get("type") == "hyp":
            out[rec["wav"]] = rec["hypothesis"]
    if not out:
        raise ValueError(f"{path}: no hypotheses")
    return out


def _hyps_for(run_dir: Path, engine: str, sid: int, ids: list[str], hyps: dict[str, str]) -> dict[str, str]:
    wdir = run_dir / "wav" / engine / f"sid{sid}"
    missing = [i for i in ids if str(wdir / f"{i}.wav") not in hyps]
    if missing:
        raise ValueError(f"{wdir}: no hypothesis for {missing[:3]} (incomplete judge run)")
    return {i: hyps[str(wdir / f"{i}.wav")] for i in ids}


def _zh_cer(sentences, hyp_by_id) -> float:
    return corpus_error_rate([tokenize_zh(t) for _, t in sentences],
                             [tokenize_zh(hyp_by_id[i]) for i, _ in sentences])


def score_zh(tag_dir: Path, sentences: list[tuple[str, str]]) -> dict:
    ids = [i for i, _ in sentences]
    judge_hyps = {j: load_hyps(tag_dir / "judge" / f"{j}.jsonl") for j in ZH_JUDGES}
    arms: dict[str, dict] = {}
    for engine in (V1_0, V1_1):
        voices = {}
        for path in sorted(tag_dir.glob(f"{engine}-sid*.jsonl")):
            run = load_run(path)
            sid = run["params"]["sid"]
            if sorted(run["rows"]) != sorted(ids):
                raise ValueError(f"{path}: sentence ids do not match the zh set")
            hyps = {j: _hyps_for(tag_dir, engine, sid, ids, judge_hyps[j]) for j in ZH_JUDGES}
            voices[sid] = {
                "speaker": run["params"]["speaker"],
                "gender": "female" if run["params"]["speaker"].startswith("zf") else "male",
                "cer": {j: _zh_cer(sentences, hyps[j]) for j in ZH_JUDGES},
                "latency": run["latency"], "rtf": run["rtf"],
                "peak_rss_mb": run["peak_rss_mb"], "load_s": run["load_s"],
                "hyps": hyps,
            }
        if not voices:
            raise ValueError(f"no runs for {engine} in {tag_dir}")
        chosen = {}
        for gender in ("female", "male"):
            pool = {s: v for s, v in voices.items() if v["gender"] == gender}
            if not pool:
                raise ValueError(f"{engine}: no {gender} voice measured")
            chosen[gender] = min(pool, key=lambda s: (sum(pool[s]["cer"].values()), s))
        chosen_sids = [chosen["female"], chosen["male"]]

        def pooled_cer(sids, judge):
            refs = [tokenize_zh(t) for _ in sids for _, t in sentences]
            hyp = [tokenize_zh(voices[s]["hyps"][judge][i]) for s in sids for i, _ in sentences]
            return corpus_error_rate(refs, hyp)

        worst = []
        for s in chosen_sids:
            for i, ref in sentences:
                per_judge = {j: sentence_error_rate(tokenize_zh(ref), tokenize_zh(voices[s]["hyps"][j][i]))
                             for j in ZH_JUDGES}
                worst.append({"speaker": voices[s]["speaker"], "sentence_id": i, "reference": ref,
                              "cer": per_judge, "mean_cer": sum(per_judge.values()) / len(per_judge),
                              "hyps": {j: voices[s]["hyps"][j][i] for j in ZH_JUDGES}})
        worst.sort(key=lambda w: (-w["mean_cer"], w["speaker"], w["sentence_id"]))
        arms[engine] = {
            "voices": voices,
            "chosen": {g: {"sid": s, "speaker": voices[s]["speaker"]} for g, s in chosen.items()},
            "cer_chosen": {j: pooled_cer(chosen_sids, j) for j in ZH_JUDGES},
            "cer_all_voices": {j: pooled_cer(sorted(voices), j) for j in ZH_JUDGES},
            "peak_rss_mb_max": max(v["peak_rss_mb"] for v in voices.values()),
            "worst5": worst[:5],
        }

    deltas = {j: arms[V1_0]["cer_chosen"][j] - arms[V1_1]["cer_chosen"][j] for j in ZH_JUDGES}
    v1_1_wins = all(d > DECISION_MARGIN_POINTS for d in deltas.values())
    return {
        "arms": arms,
        "decision": {
            "rule": "reuse v1_0 unless v1_1 CER is lower by > 2 points under both judges",
            "v1_0_minus_v1_1_cer_points": deltas,
            "winner": V1_1 if v1_1_wins else V1_0,
        },
    }


def score_en_regression(tag_dir: Path, sentences: list[tuple[str, str]]) -> dict:
    ids = [i for i, _ in sentences]
    hyps = load_hyps(tag_dir / "judge" / f"{EN_JUDGE}.jsonl")
    refs = [normalize_en(t) for _, t in sentences]
    runs = {
        "en-only": (tag_dir / "en", "kokoro-v1_0-en-only"),
        "en-zh": (tag_dir / "en", "kokoro-v1_0-en-zh"),
        "en-only-control": (tag_dir / "en-control", "kokoro-v1_0-en-only"),
    }
    per_sid: dict = defaultdict(dict)
    for label, (run_dir, engine) in runs.items():
        for path in sorted(run_dir.glob(f"{engine}-sid*.jsonl")):
            run = load_run(path)
            sid = run["params"]["sid"]
            h = _hyps_for(run_dir, engine, sid, ids, hyps)
            per_sid[sid][label] = {
                "p95_s": run["latency"]["p95_s"], "mean_s": run["latency"]["mean_s"], "rtf": run["rtf"],
                "peak_rss_mb": run["peak_rss_mb"],
                "wer": corpus_error_rate(refs, [normalize_en(h[i]) for i in ids]),
                "sha": {i: run["rows"][i]["samples_sha256"] for i in ids},
                "n_samples": {i: run["rows"][i]["n_samples"] for i in ids},
            }
    out = {}
    for sid, by in sorted(per_sid.items()):
        if set(by) != set(runs):
            raise ValueError(f"en regression sid {sid}: missing runs {set(runs) - set(by)}")
        base, cand, ctrl = by["en-only"], by["en-zh"], by["en-only-control"]

        def same(a, b, key):
            return sum(a[key][i] == b[key][i] for i in ids)

        p95_delta = (cand["p95_s"] - base["p95_s"]) / base["p95_s"]
        noise_wer = max(base["wer"], ctrl["wer"])
        out[sid] = {
            "speaker": {9: "af_sarah", 11: "am_adam"}.get(sid, str(sid)),
            "byte_identical_vs_en_only": same(base, cand, "sha"),
            "byte_identical_control": same(base, ctrl, "sha"),
            "same_length_vs_en_only": same(base, cand, "n_samples"),
            "same_length_control": same(base, ctrl, "n_samples"),
            "n": len(ids),
            "p95_s": {k: v["p95_s"] for k, v in by.items()},
            "mean_s": {k: v["mean_s"] for k, v in by.items()},
            "peak_rss_mb": {k: v["peak_rss_mb"] for k, v in by.items()},
            "wer": {k: v["wer"] for k, v in by.items()},
            "p95_delta_pct": 100 * p95_delta,
            "pass": abs(p95_delta) <= P95_TOLERANCE and cand["wer"] <= noise_wer,
        }
    all_identical = all(v["byte_identical_vs_en_only"] == v["n"] for v in out.values())
    return {
        "per_sid": out,
        "verdict": "PASS (byte-identical)" if all_identical
        else ("PASS (p95 within ±10%, WER within run-to-run control)"
              if all(v["pass"] for v in out.values()) else "FAIL"),
    }


def _fmt_lat(v: dict) -> str:
    lat = v["latency"]
    return f"{lat['mean_s']:.2f} | {lat['p50_s']:.2f} | {lat['p95_s']:.2f} | {v['rtf']:.3f}"


def render_markdown(result: dict) -> str:
    zh, en = result["zh"], result["en_regression"]
    out = ["## Per voice (zh, 30 sentences)", "",
           "| Arm | sid | Speaker | CER SenseVoice % | CER Paraformer % | mean s | p50 s | p95 s | RTF | Peak RSS MB |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for engine, arm in zh["arms"].items():
        for sid, v in sorted(arm["voices"].items()):
            out.append(f"| {engine} | {sid} | {v['speaker']} | {v['cer']['sensevoice-zh']:.1f} "
                       f"| {v['cer']['paraformer-zh']:.1f} | {_fmt_lat(v)} | {v['peak_rss_mb']:.0f} |")
    out += ["", "## Per arm", "",
            "| Arm | Chosen F / M | CER SV (chosen) | CER PF (chosen) | CER SV (all voices) | CER PF (all voices) | Peak RSS MB (max) |",
            "|---|---|---|---|---|---|---|"]
    for engine, arm in zh["arms"].items():
        c = arm["chosen"]
        out.append(f"| {engine} | {c['female']['speaker']} ({c['female']['sid']}) / "
                   f"{c['male']['speaker']} ({c['male']['sid']}) "
                   f"| {arm['cer_chosen']['sensevoice-zh']:.1f} | {arm['cer_chosen']['paraformer-zh']:.1f} "
                   f"| {arm['cer_all_voices']['sensevoice-zh']:.1f} | {arm['cer_all_voices']['paraformer-zh']:.1f} "
                   f"| {arm['peak_rss_mb_max']:.0f} |")
    d = zh["decision"]
    out += ["", f"Decision: {d['rule']}. v1_0 − v1_1 CER points: "
            + ", ".join(f"{j} {v:+.1f}" for j, v in d["v1_0_minus_v1_1_cer_points"].items())
            + f". Winner: **{d['winner']}**.", ""]
    for engine, arm in zh["arms"].items():
        out += [f"## Worst 5 — {engine}", "", "| Speaker | id | CER SV / PF | Reference | SenseVoice | Paraformer |",
                "|---|---|---|---|---|---|"]
        for w in arm["worst5"]:
            out.append(f"| {w['speaker']} | {w['sentence_id']} | {w['cer']['sensevoice-zh']:.0f} / "
                       f"{w['cer']['paraformer-zh']:.0f} | {w['reference']} | {w['hyps']['sensevoice-zh']} "
                       f"| {w['hyps']['paraformer-zh']} |")
        out.append("")
    out += ["## en regression (v1_0, en-only vs en+zh config)", "",
            "| sid | Speaker | identical samples (vs en-only / control) | identical length (vs en-only / control) "
            "| p95 en-only / en-zh / control s | p95 Δ % | WER en-only / en-zh / control % | Pass |",
            "|---|---|---|---|---|---|---|---|"]
    for sid, v in en["per_sid"].items():
        p, w = v["p95_s"], v["wer"]
        out.append(f"| {sid} | {v['speaker']} | {v['byte_identical_vs_en_only']}/{v['n']} / "
                   f"{v['byte_identical_control']}/{v['n']} | {v['same_length_vs_en_only']}/{v['n']} / "
                   f"{v['same_length_control']}/{v['n']} | {p['en-only']:.2f} / {p['en-zh']:.2f} / "
                   f"{p['en-only-control']:.2f} | {v['p95_delta_pct']:+.1f} | {w['en-only']:.1f} / "
                   f"{w['en-zh']:.1f} / {w['en-only-control']:.1f} | {'yes' if v['pass'] else 'no'} |")
    out += ["", f"en verdict: **{en['verdict']}**", ""]
    return "\n".join(out)


def _strip_hyps(zh: dict) -> dict:
    """summary.json keeps per-voice scores; the hypotheses live in judge/*.jsonl."""
    slim = json.loads(json.dumps(zh))
    for arm in slim["arms"].values():
        for v in arm["voices"].values():
            v.pop("hyps", None)
    return slim


def score_run(tag_dir: Path, zh_sentences_path: Path, en_sentences_path: Path) -> dict:
    result = {
        "zh": score_zh(tag_dir, load_sentences(zh_sentences_path)),
        "en_regression": score_en_regression(tag_dir, load_sentences(en_sentences_path)),
    }
    summary = {"zh": _strip_hyps(result["zh"]), "en_regression": result["en_regression"]}
    (tag_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (tag_dir / "summary.md").write_text(render_markdown(result), encoding="utf-8")
    print(f"[done] {tag_dir / 'summary.json'} and summary.md")
    return result
