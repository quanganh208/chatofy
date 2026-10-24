"""Score a run: summary.json, summary.md and the machine verdict gate.json.

    uv run --frozen python score.py --run-tag r1
    uv run --frozen python score.py --run-tag public-prelim-r1 --substitute-public

Every arm is scored in three variants -- `bare` (no prior), `src` (source
prior, always on in the API) and `src+voice` (plus the voice prior) -- with
thresholds chosen leave-one-group-out (lid_bench.tuning). The gate judges the
`src` variant; `prior_used` is true only when the winner's `src+voice` lowers
A2's post-fallback error by at least one point over `src`, and then the
winner is judged in that variant.

`--ruler v5` leaves turns that carry no language out of every speech
criterion, for all languages alike: Silero speech under the API's floor
(never decoded live) and turns whose reference transcript is fillers only
(`lid_bench.fillers`, transcripts from `scripts/attach_transcripts.py`). Each
v5 row is printed beside its unamended `v4.` twin, which never gates.

`--substitute-public` lets public read speech stand in where real speech is
required. The rows say so, and the outcome is then always INCOMPLETE: it is
a preliminary signal, never a verdict.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import gate, tuning  # noqa: E402
from lid_bench.fillers import is_filler_only  # noqa: E402
from lid_bench.prior import ClientVoiceLabels  # noqa: E402
from lid_bench.run_data import ArmData, load_run, set_latency  # noqa: E402
from lid_bench.scoring import (  # noqa: E402
    STT_MIN_SPEECH_MS,
    Result,
    criteria,
    detect_2way_episodes,
    episodes,
    noise_rejection,
)

RESULTS = BENCH_ROOT / "results"
TRANSCRIPTS = BENCH_ROOT / "data" / "transcripts.jsonl"
VARIANTS = {"bare": (False, False), "src": (True, False), "src+voice": (True, True)}
TAU_NOISE_GRID = (0.0, 0.5, 0.6, 0.7, 0.8, 0.9)
#: Share of real speech turns a noise threshold may throw away.
SPEECH_LOSS_BUDGET = 0.01
PRIOR_GAIN = 0.01


def client_labels(turns, facts) -> dict[str, int | None]:
    labels: dict[str, int | None] = {}
    sessions: dict[str, list] = {}
    for turn in turns:
        if turn.session is not None and not turn.noise:
            sessions.setdefault(turn.session, []).append(turn)
    for members in sessions.values():
        clusterer = ClientVoiceLabels()
        for turn in sorted(members, key=lambda t: t.order):
            vector = facts.get(turn.id, {}).get("embedding")
            labels[turn.id] = clusterer.label(np.asarray(vector, dtype=np.float32)) if vector else None
    return labels


def no_language_turns(turns, facts) -> frozenset[str]:
    """Ruler v5's exclusions: under the speech floor, or fillers only."""
    if not TRANSCRIPTS.exists():
        raise SystemExit(f"--ruler v5 needs {TRANSCRIPTS.relative_to(BENCH_ROOT)}: run scripts/attach_transcripts.py")
    texts = {}
    for line in TRANSCRIPTS.read_text().splitlines():
        row = json.loads(line)
        texts[row["id"]] = row["text"]
    out = set()
    for turn in turns:
        silero = facts.get(turn.id, {}).get("silero_ms")
        if silero is not None and silero < STT_MIN_SPEECH_MS:
            out.add(turn.id)
        elif is_filler_only(texts.get(turn.id), turn.lang):
            out.add(turn.id)
    return frozenset(out)


def with_v4_twins(v5: dict[str, Result], v4: dict[str, Result]) -> dict[str, Result]:
    """v5 rows, plus each unamended v4 row as a report-only `v4.` twin."""
    out = dict(v5)
    for name, r in v4.items():
        out[f"v4.{name}"] = Result(f"v4.{name}", r.value, "report", None, r.n, r.data)
    return out


def added_latency(arm: ArmData, eps) -> list[float]:
    """A7: final-decode time the decision adds over a declared pair, per trial.

    A model arm runs before the one decode: it adds its own latency. Arm 4
    decodes every candidate in parallel: it adds the slowest candidate (or the
    fused LID model, run beside them) minus the declared engine (the source;
    detect has none, so the true language)."""
    added = []
    for ep in eps:
        for turn in ep.turns:
            if arm.engine_ms:
                ms = arm.engine_ms[turn.id]
                baseline = ms[ep.source or turn.lang]
                added.append(set_latency(ms, ep.candidates) - baseline)
            else:
                added.append(arm.latency[(turn.id, None)]["+".join(sorted(ep.candidates))])
    return added


#: Two-way is where a noise turn would become a spoken translation (A5), and
#: en-vi is the pair every session in the real set uses.
NOISE_PAIR = ("en", "vi")


def _noise_source(turn) -> str:
    return "real" if turn.real else turn.source


def _pick_tau(noise, speech, silero, max_prob) -> float:
    """Smallest tau that drops >= 90% of `noise` within the speech-loss budget, else 0."""
    for tau in TAU_NOISE_GRID:
        counted = noise_rejection(noise, silero, max_prob, tau)
        lost = np.mean([max_prob.get(t.id, 1.0) < tau for t in speech]) if speech else 0.0
        if counted and counted[1] and counted[0] / counted[1] >= 0.90 and lost <= SPEECH_LOSS_BUDGET:
            return tau
    return 0.0


def choose_tau_noise(arm: ArmData, turns, facts) -> tuple[float, dict, float, str]:
    """`tau_noise` chosen with each noise group held out; returns (tau chosen on
    everything, held-out (rejected, total) per noise source, speech lost at
    that tau, scheme)."""
    noise = [t for t in turns if t.noise]
    # The loss budget is about real speech; with none labelled yet, public
    # speech stands in rather than letting the budget pass vacuously.
    speech = [t for t in turns if not t.noise and t.real] or [t for t in turns if not t.noise]
    max_prob = {t.id: max(arm.full(t.id, NOISE_PAIR).values()) for t in turns if (t.id, None) in arm.probs}
    silero = {t.id: facts[t.id]["silero_ms"] for t in turns if "silero_ms" in facts.get(t.id, {})}
    groups = sorted({t.group for t in noise})
    held: dict[str, list] = {}
    scheme = "logo" if len(groups) >= 2 else "in-sample"
    for group in groups:
        test = [t for t in noise if t.group == group]
        train = [t for t in noise if t.group != group] if scheme == "logo" else test
        counted = noise_rejection(test, silero, max_prob, _pick_tau(train, speech, silero, max_prob))
        bucket = held.setdefault(_noise_source(test[0]), [0, 0])
        if counted is None or bucket is None:
            held[_noise_source(test[0])] = None
        else:
            bucket[0] += counted[0]
            bucket[1] += counted[1]
    tau = _pick_tau(noise, speech, silero, max_prob)
    lost = float(np.mean([max_prob.get(t.id, 1.0) < tau for t in speech])) if speech else 0.0
    return tau, {k: (tuple(v) if v else None) for k, v in held.items()}, lost, scheme


def score_arm(name: str, arm: ArmData, turns, facts, voices, substitute: bool,
              excluded: frozenset[str] | None) -> dict:
    """`excluded` None scores ruler v4; a set scores v5 with v4 twins."""
    speech_turns = [t for t in turns if not t.noise and (t.id, None) in arm.probs]
    eps = episodes(speech_turns)
    eps_2way = detect_2way_episodes(speech_turns)
    tau_noise, noise, lost, noise_scheme = choose_tau_noise(arm, turns, facts)
    added = added_latency(arm, eps)
    out = {"cv": arm.cv_scheme, "tau_noise": tau_noise, "noise_scheme": noise_scheme,
           "speech_lost_to_tau_noise": round(lost, 4), "variants": {}}
    for variant, (tune_prior, voice_prior) in VARIANTS.items():
        trials, trials_2way, scheme = tuning.held_out_with(eps, eps_2way, arm.full, arm.prefixes, voice_prior,
                                                           voices, tune_prior)
        params, lock = tuning.choose(eps, arm.full, arm.prefixes, voice_prior, voices, tune_prior)
        results = criteria(trials, added, noise, substitute, detect_2way=trials_2way)
        if excluded is not None:
            results = with_v4_twins(
                criteria(trials, added, noise, substitute, excluded=excluded, detect_2way=trials_2way), results)
        out["variants"][variant] = {
            "scheme": scheme,
            "thresholds": {"source_prior_logodds": params.source_prior_logodds,
                           "tau_uncertain": params.tau_uncertain, "tau_confident": params.tau_confident,
                           "tau_lock": lock.tau_lock if lock else None,
                           "lock_min_speech_ms": lock.lock_min_speech_ms if lock else None,
                           "tau_noise": tau_noise},
            "results": results,
        }
    return out


def judged_variant(data: dict) -> str:
    """`src+voice` when the voice prior lowers A2's (vi<->en) post-fallback
    error by at least PRIOR_GAIN over `src`; else `src`."""
    src = data["variants"]["src"]["results"].get("A2.en-vi.err_after_fallback")
    voice = data["variants"]["src+voice"]["results"].get("A2.en-vi.err_after_fallback")
    if src and voice and src.value is not None and voice.value is not None and src.value - voice.value >= PRIOR_GAIN:
        return "src+voice"
    return "src"


def unsound(data: dict) -> bool:
    """Numbers that must not decide: thresholds chosen in-sample, or a
    classifier validated by k-fold (one group) instead of leave-one-group-out."""
    schemes = {v["scheme"] for v in data["variants"].values()} | {data["noise_scheme"]}
    return "in-sample" in schemes or "kfold" in (data["cv"] or "")


def render_md(tag: str, scored: dict, outcome: str, winner: str | None, ruler: str = "v4") -> str:
    names = sorted({n for arm in scored.values() for v in arm["variants"].values() for n in v["results"]})
    lines = [f"# LID bake-off `{tag}` (ruler {ruler})", "",
             f"Outcome: **{outcome}**" + (f", winner `{winner}`" if winner else ""), ""]
    for arm, data in scored.items():
        lines += [f"## {arm} (cv {data['cv']}, tau_noise {data['tau_noise']})", "",
                  "| criterion | " + " | ".join(data["variants"]) + " | threshold | data |",
                  "|---|" + "---|" * len(data["variants"]) + "---|---|"]
        for n in names:
            cells, threshold, source = [], "", ""
            for v in data["variants"].values():
                r = v["results"].get(n)
                if r is None:
                    cells.append("—")
                    continue
                mark = {True: "✓", False: "✗", None: "·"}[r.passed]
                cells.append("—" if r.value is None else f"{r.value:.3f} {mark} (n={r.n})")
                threshold, source = r.threshold, r.data
            lines.append(f"| {n} | " + " | ".join(cells) + f" | {threshold} | {source} |")
        lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-tag", required=True)
    parser.add_argument("--substitute-public", action="store_true")
    parser.add_argument("--ruler", choices=("v4", "v5"), default="v4")
    args = parser.parse_args()

    run_dir = next((d for d in (RESULTS / args.run_tag, RESULTS / "private" / args.run_tag) if d.exists()), None)
    if run_dir is None:
        raise SystemExit(f"no run {args.run_tag} under {RESULTS}")
    turns, facts, arms = load_run(run_dir)
    voices = client_labels(turns, facts)
    excluded = no_language_turns(turns, facts) if args.ruler == "v5" else None
    scored = {name: score_arm(name, arm, turns, facts, voices, args.substitute_public, excluded)
              for name, arm in arms.items()}

    variants = {name: judged_variant(data) for name, data in scored.items()}
    per_arm = {name: data["variants"][variants[name]]["results"] for name, data in scored.items()}
    flagged = frozenset(name for name, data in scored.items() if unsound(data))
    outcome, winner, notes = gate.verdict(per_arm, {n: a.info for n, a in arms.items()}, flagged,
                                           gate.PLANNED_ARMS)
    if args.substitute_public:
        outcome, winner = "INCOMPLETE", None
        notes = notes + ["--substitute-public: preliminary signal, never a verdict"]
    chosen = winner or (max(scored, key=lambda n: per_arm[n]["A1.en-vi"].value or 0) if scored else None)
    prior_used = bool(chosen) and variants[chosen] == "src+voice"
    variant = variants[chosen] if chosen else "src"

    markdown = render_md(args.run_tag, scored, outcome, winner, args.ruler)
    for data in scored.values():
        for v in data["variants"].values():
            v["results"] = {k: r.as_dict() for k, r in v["results"].items()}
    summary = {"run_tag": args.run_tag, "ruler": args.ruler, "substitute_public": args.substitute_public,
               "arms": scored,
               "arm_info": {n: a.info.__dict__ for n, a in arms.items()}}
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    for name, arm in arms.items():
        if arm.models:
            (run_dir / f"{name}.model.json").write_text(json.dumps(arm.models, indent=1) + "\n")

    best = scored[chosen]["variants"][variant] if chosen else None
    gate_json = {
        "per_arm": {n: {"variant": variants[n], **d["variants"][variants[n]]["results"]} for n, d in scored.items()},
        "zh_real": {n: {k: v for k, v in d["variants"][variants[n]]["results"].items() if k.startswith("zh_real.")}
                    for n, d in scored.items()},
        "winner": winner, "outcome": outcome, "notes": notes, "unsound": sorted(flagged), "prior_used": prior_used,
        "thresholds": best["thresholds"] if best else None,
        "rss_delta_mib": arms[winner].info.rss_delta_mib if winner else None,
        "p95_added_ms": best["results"]["A7"]["value"] if best else None,
        "runtime_artifact": None,
        "substitute_public": args.substitute_public,
        "ruler": args.ruler,
    }
    (run_dir / "gate.json").write_text(json.dumps(gate_json, indent=2) + "\n")
    (run_dir / "summary.md").write_text(markdown)
    print(f"outcome {outcome} winner {winner} prior_used {prior_used} -> {run_dir.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
