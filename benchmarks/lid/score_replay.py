"""Score `replay_sessions.mjs` rows against the criteria the offline gate used.

    python3 score_replay.py --run results/p3-two-way --baseline results/p3-declared

Online, a turn's language is what the API put on it: the final segment's
source language, and the language the first partial showed. A two-way run is
scored on its own (A1, A2, A4, A6, A9-mono), against the declared run of the
same sessions (A5, A7), and against what the offline gate's recorded
probabilities say the same policy decides on the same turns (A13). An
adversarial run is scored for A12 alone.

`--limit`-sized runs land in results/smoke; scoring one writes nothing unless
`--out` names a file, so a smoke score can never overwrite a recorded one.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
OFFLINE_SCORES = HERE / "results" / "conv-r4-ctx5" / "whisper_probs_base_ctx5.scores.jsonl"
PAIR = ("en", "vi")
# The shipped policy (`apps/api/.../turn-tuning.ts`).
UNCERTAIN_BELOW = 0.6
SHORT_MS = 1500


def rows(run: Path) -> list[dict]:
    return [json.loads(line) for line in (run / "replay.jsonl").read_text().splitlines() if line.strip()]


def p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def rate(hits: int, n: int) -> float | None:
    return round(hits / n, 4) if n else None


def speech(row: dict) -> bool:
    return not row["noise"]


def correct(row: dict) -> bool:
    return row["final_language"] == row["lang"]


def offline_finals(turns: list[dict]) -> dict[str, str]:
    """What the policy decides offline from the gate's recorded whole-turn probabilities.

    The recorded scores are over en+vi+zh; masking the sidecar's softmax to the
    pair is the same as renormalising them over it. An unsure turn falls back to
    the previous turn's decided language, then to the declared source.
    """
    whole: dict[str, dict[str, float]] = {}
    for line in OFFLINE_SCORES.read_text().splitlines():
        rec = json.loads(line)
        if rec["prefix_ms"] is None:
            whole[rec["id"]] = rec["probs"]["en+vi+zh"]
    decided: dict[str, str] = {}
    previous: dict[str, str] = {}
    for turn in turns:
        probs = whole.get(turn["turn"])
        if probs is None:
            continue
        total = sum(probs[lang] for lang in PAIR)
        best = max(PAIR, key=lambda lang: probs[lang])
        if probs[best] / total >= UNCERTAIN_BELOW:
            language = best
        else:
            language = previous.get(turn["session"]) or turn["declared_source"]
        decided[turn["turn"]] = language
        previous[turn["session"]] = language
    return decided


def identified(run: list[dict], baseline: list[dict] | None, mode: str) -> dict:
    """A two-way or detect run: both decide every turn's language among the candidates."""
    asked = [r for r in run if r["asked"] == mode]
    served = [r for r in asked if r["ready_mode"] == mode]
    talk = [r for r in served if speech(r) and not r["mono"] and r["final_language"] is not None]
    long_ = [r for r in talk if r["speech_ms"] >= SHORT_MS]
    short = [r for r in talk if r["speech_ms"] < SHORT_MS]
    codeswitch = [r for r in talk if r["codeswitch"] and r["lang"] == "vi"]
    out: dict = {
        "turns": len(asked),
        "served": len(served),
        "degraded": {r["mode_reason"] for r in asked if r["ready_mode"] != mode} or None,
        "errors": sorted({r["error"] for r in asked if r["error"]}) or None,
        "A1.en-vi": {"value": rate(sum(map(correct, long_)), len(long_)), "threshold": ">=0.97", "n": len(long_)},
        # Online there is no raw label to score: the API only ever shows the
        # language after the fallback, so A2 is the error after it.
        "A2.en-vi.err_after_fallback": {
            "value": rate(sum(not correct(r) for r in short), len(short)),
            "threshold": "<=0.05",
            "n": len(short),
        },
        "A4": {"value": rate(sum(r["final_language"] == "vi" for r in codeswitch), len(codeswitch)),
               "threshold": ">=0.95", "n": len(codeswitch)},
    }
    locked = [r for r in talk if any(r["partial_languages"])]
    changed = [r for r in locked if r["first_language"] != r["final_language"]]
    out["A6.changed"] = {"value": rate(len(changed), len(talk)), "threshold": "<=0.10", "n": len(talk)}
    out["A6.first_language_p95_ms"] = {
        "value": p95([r["first_language_ms"] for r in talk if r["first_language_ms"] is not None]),
        "threshold": "<=3500",
        "n": len(talk),
    }
    out["A6.locked_share"] = {"value": rate(len(locked), len(talk)), "threshold": "report", "n": len(talk)}
    for lang in PAIR:
        mono = [r for r in served if r["mono"] and r["lang"] == lang and speech(r) and r["final_language"]]
        out[f"A9-mono.{lang}"] = {
            "value": rate(sum(not correct(r) for r in mono), len(mono)),
            "threshold": "<=0.03",
            "n": len(mono),
        }
    noise = [r for r in served if r["noise"]]
    out["A5.noise_finals"] = {"value": sum(r["final_language"] is not None for r in noise), "n": len(noise)}

    offline = offline_finals(talk)
    scored = [r for r in long_ if r["turn"] in offline]
    online_acc = rate(sum(map(correct, scored)), len(scored))
    offline_acc = rate(sum(offline[r["turn"]] == r["lang"] for r in scored), len(scored))
    out["A13.A1"] = {
        "online": online_acc,
        "offline": offline_acc,
        "threshold": "online >= offline - 0.02",
        "pass": None if online_acc is None or offline_acc is None else online_acc >= offline_acc - 0.02,
        "n": len(scored),
        "disagree": sum(offline[r["turn"]] != r["final_language"] for r in scored),
    }

    if baseline is not None:
        base = {r["turn"]: r for r in baseline if r["asked"] == "declared"}
        paired = [(r, base[r["turn"]]) for r in served if r["turn"] in base]
        added = [
            r["final_ms"] - b["final_ms"]
            for r, b in paired
            if r["final_ms"] is not None and b["final_ms"] is not None and speech(r)
        ]
        out["A7.added_final_ms_p95"] = {"value": p95(added), "threshold": "<=150", "n": len(added)}
        out["A7.final_ms_p95"] = {
            "two_way": p95([r["final_ms"] for r, _ in paired if r["final_ms"] is not None]),
            "declared": p95([b["final_ms"] for _, b in paired if b["final_ms"] is not None]),
        }
        base_noise = [b for _, b in paired if b["noise"]]
        out["A5.noise_finals"]["declared"] = sum(b["final_language"] is not None for b in base_noise)
        out["A5.noise_finals"]["pass"] = out["A5.noise_finals"]["value"] <= out["A5.noise_finals"]["declared"]
    return out


def mixed_load(run: list[dict]) -> dict:
    """A12: every turn of a mixed load answered, none refused as busy."""
    out: dict = {}
    for mode in ("detect", "two-way"):
        mine = [r for r in run if r["asked"] == mode]
        out[mode] = {
            "turns": len(mine),
            "served": sum(r["ready_mode"] == mode for r in mine),
            "errors": {e: sum(r["error"] == e for r in mine) for e in {r["error"] for r in mine if r["error"]}},
            "final_ms_p95": p95([r["final_ms"] for r in mine if r["final_ms"] is not None]),
        }
    # A sidecar 503 reaches the client as a failed turn, not a code of its own;
    # the API log says which failures were busy refusals.
    failed = sum(r["error"] is not None for r in run)
    out["A12.failed_turns"] = {"value": failed, "threshold": "==0 busy (see api log)", "n": len(run)}
    return out


def adversarial(run: list[dict]) -> dict:
    return {
        "sockets": len(run),
        "A12.identifying_sockets": {
            "value": sum(r["ready_mode"] == "two-way" for r in run),
            "threshold": "==1",
        },
        "modes": [r["ready_mode"] for r in run],
        "reasons": [r["mode_reason"] for r in run],
        "errors": [r["error"] for r in run],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    meta = json.loads((args.run / "replay.json").read_text())
    run = rows(args.run)
    if meta["mode"] == "adversarial":
        result = adversarial(run)
    elif meta["mode"] == "mixed-load":
        result = mixed_load(run)
    elif meta["mode"] == "declared":
        result = {
            "turns": len(run),
            "errors": sorted({r["error"] for r in run if r["error"]}) or None,
            "final_ms_p95": p95([r["final_ms"] for r in run if r["final_ms"] is not None]),
        }
    else:
        result = identified(run, rows(args.baseline) if args.baseline else None, meta["mode"])
    result["run"] = meta
    text = json.dumps(result, indent=2, default=lambda v: sorted(v) if isinstance(v, set) else str(v))
    print(text)
    out = args.out if args.out else (None if args.run.name == "smoke" else args.run / "summary.json")
    if out is not None:
        out.write_text(text + "\n")


if __name__ == "__main__":
    main()
