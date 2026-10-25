"""`detect2v3` holds every arm against the 2-way detect prod runs, not its own."""

import importlib.util
from pathlib import Path

from lid_bench.gate import ArmInfo
from lid_bench.manifest import LANGUAGES, Turn
from lid_bench.run_data import FULL_KEY, ArmData

spec = importlib.util.spec_from_file_location("score", Path(__file__).resolve().parents[1] / "score.py")
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)


def turns():
    out = []
    for g in ("a", "b"):
        for i, lang in enumerate(["vi", "en", "zh"] * 4):
            out.append(Turn(id=f"{g}{i}", audio="x.wav", lang=lang, bucket="<1.5", speech_ms=900, channel="laptop",
                            group=g, source=g, real=True, license="x", session=f"s{g}{i // 3}", order=i % 3))
    return out


def arm(right_on) -> ArmData:
    """Sure of the true language on turns `right_on` accepts, else sure of a wrong one."""
    data = ArmData(info=ArmInfo(arm="x", kind="lid-model", runtime="x"))
    for t in turns():
        guess = t.lang if right_on(t) else next(l for l in LANGUAGES if l != t.lang and l != "zh")
        data.probs[(t.id, None)] = {FULL_KEY: {l: (0.98 if l == guess else 0.01) for l in LANGUAGES}}
        data.latency[(t.id, None)] = {FULL_KEY: 10.0}
        data.speech_ms[(t.id, None)] = 900
    return data


def test_an_arm_better_than_prod_is_not_charged_for_beating_its_own_two_way():
    ts = turns()
    facts = {t.id: {"silero_ms": 900} for t in ts}
    prod = arm(lambda t: t.lang != "vi" or int(t.id[1:]) % 2 == 0)  # wrong on half the vi turns
    perfect = arm(lambda t: True)
    base = score.score_arm("prod", prod, ts, facts, None, False, None)["_two_way"]
    own = score.score_arm("new", perfect, ts, facts, None, False, None)
    held = score.score_arm("new", perfect, ts, facts, None, False, None, base)
    assert own["variants"]["src"]["results"]["detect2v3.short.vi"].value == 0.0
    assert held["variants"]["src"]["results"]["detect2v3.short.vi"].value > 0.0


def test_no_baseline_leaves_the_rows_unscored_rather_than_using_the_arms_own():
    ts = turns()
    facts = {t.id: {"silero_ms": 900} for t in ts}
    out = score.score_arm("new", arm(lambda t: True), ts, facts, None, False, None, {})
    assert "detect2v3.short.vi" not in out["variants"]["src"]["results"]
