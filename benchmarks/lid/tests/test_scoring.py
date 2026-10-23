import numpy as np

from lid_bench.gate import PLANNED_ARMS, REQUIRED_VIEN, REQUIRED_ZH, ArmInfo, verdict
from lid_bench.manifest import Turn
from lid_bench.prior import ClientVoiceLabels, Params, decide_session, with_source_prior
from lid_bench.scoring import Result, criteria, episodes, run_trials


def turn(i, lang, *, session=None, order=None, real=True, bucket="3-8", speech=4000, **kw):
    return Turn(id=f"t{i}", audio="x.wav", lang=lang, bucket=bucket, speech_ms=speech, channel="laptop",
                group=kw.pop("group", "g"), source="recorded" if real else "fleurs", real=real, license="x",
                session=session, order=order, **kw)


def test_source_prior_shifts_towards_source_and_stays_normalised():
    out = with_source_prior({"vi": 0.4, "en": 0.6}, "vi", 1.0)
    assert out["vi"] > 0.4
    assert abs(sum(out.values()) - 1) < 1e-9


def test_fallback_chain_previous_then_source():
    probs = [{"vi": 0.55, "en": 0.45}, {"vi": 0.95, "en": 0.05}, {"vi": 0.5, "en": 0.5}]
    out = decide_session(probs, "en", Params(tau_uncertain=0.8))
    assert [d.via for d in out] == ["source", "model", "previous"]
    assert [d.final for d in out] == ["en", "vi", "vi"]


def test_confident_other_language_turn_lifts_the_source_prior():
    probs = [{"vi": 0.95, "en": 0.05}, {"vi": 0.4, "en": 0.6}]
    out = decide_session(probs, "en", Params(source_prior_logodds=2.0))
    # Turn 1 is confidently vi (not the source en): the prior is gone for turn 2.
    assert out[1].final == "en"  # 0.6 en without any bonus
    still = decide_session([{"vi": 0.6, "en": 0.4}], "en", Params(source_prior_logodds=2.0))
    assert still[0].final == "en"  # bonus applied while no evidence


def test_second_voice_lifts_the_source_prior():
    probs = [{"vi": 0.3, "en": 0.7}, {"vi": 0.7, "en": 0.3}]
    lifted = decide_session(probs, "en", Params(source_prior_logodds=3.0), voices=[0, 1])
    held = decide_session(probs, "en", Params(source_prior_logodds=3.0), voices=[0, 0])
    assert lifted[1].final == "vi" and held[1].final == "en"


def test_voice_prior_uses_the_voices_confident_history():
    probs = [{"vi": 0.95, "en": 0.05}, {"vi": 0.1, "en": 0.9}, {"vi": 0.5, "en": 0.5}]
    out = decide_session(probs, "en", Params(tau_uncertain=0.8, voice_prior=True), voices=[0, 1, 0])
    assert out[2].via == "voice" and out[2].final == "vi"


def test_detect_without_source_falls_back_to_the_model():
    out = decide_session([{"vi": 0.4, "en": 0.35, "zh": 0.25}], None, Params(tau_uncertain=0.9))
    assert out[0].final == "vi"


def test_client_labels_mint_after_two_confirmations_and_cap_at_two():
    rng = np.random.default_rng(1)
    a, b, c = (rng.normal(size=16) for _ in range(3))
    labels = ClientVoiceLabels()
    seq = [labels.label(v + rng.normal(scale=0.01, size=16)) for v in (a, a, b, b, a, c, c)]
    assert seq[:2] == [None, 0]  # first turn is provisional
    assert seq[3] == 1 and seq[4] == 0
    assert len(labels.voices) == 2  # the third voice never gets a label of its own


def test_every_turn_is_tried_in_both_orientations_of_each_pair():
    eps = episodes([turn(1, "vi")])
    pairs = {(e.candidates, e.source) for e in eps}
    assert (("en", "vi"), "en") in pairs and (("en", "vi"), "vi") in pairs
    assert (("vi", "zh"), "zh") in pairs and (("en", "vi", "zh"), None) in pairs


def test_declared_source_restricts_orientation():
    turns = [turn(1, "vi", session="s", order=0, declared_source="vi"),
             turn(2, "en", session="s", order=1, declared_source="vi")]
    eps = [e for e in episodes(turns) if len(e.candidates) == 2]
    assert [(e.candidates, e.source) for e in eps] == [(("en", "vi"), "vi")]


def perfect(turns):
    lang = {t.id: t.lang for t in turns}
    return lambda tid, cands: {c: (0.99 if c == lang[tid] else 0.01 / (len(cands) - 1)) for c in cands}


def test_real_only_criterion_is_insufficient_without_real_data_unless_substituted():
    turns = [turn(i, l, real=False) for i, l in enumerate(["vi", "en", "zh"] * 3)]
    trials = run_trials(episodes(turns), perfect(turns), None, Params(), None)
    strict = criteria(trials, [0.0], {"esc50": (9, 10)})
    assert strict["A1.en-vi"].passed is None and strict["A1.en-vi"].n == 0
    loose = criteria(trials, [0.0], {"esc50": (9, 10)}, substitute=True)
    assert loose["A1.en-vi"].passed is True and loose["A1.en-vi"].data == "public-substitute"


def test_l2arctic_counts_only_for_accent_criteria():
    accented = Turn(id="acc", audio="x", lang="en", bucket="3-8", speech_ms=4000, channel="read",
                    group="l2arctic", source="l2arctic", real=False, license="x", accent_l1="vi")
    turns = [turn(1, "vi"), turn(2, "en"), accented]
    trials = run_trials(episodes(turns), perfect(turns), None, Params(), None)
    out = criteria(trials, [0.0], {})
    assert out["A-ACC.pair"].n == 2  # both orientations
    assert out["A1.en-vi"].n == 4  # vi and en, both orientations; the accented turn excluded


def results(passing: set[str], data="real") -> dict[str, Result]:
    names = REQUIRED_VIEN + REQUIRED_ZH
    return {n: Result(n, 1.0 if n in passing else 0.0, "", n in passing, 10, data) for n in names}


def test_gate_outcomes():
    lid = ArmInfo("ambernet", "lid-model", "onnxruntime-1.27.0", parity_passed=True, rss_peak_mib=300)
    rec = ArmInfo("rc", "recognizer", "onnxruntime-1.27.0", new_model=False, rss_peak_mib=2000)
    gpu = ArmInfo("mms", "lid-model", "transformers", needs_gpu=True)
    everything = set(REQUIRED_VIEN + REQUIRED_ZH)
    arms = {"ambernet": lid, "rc": rec, "mms": gpu}
    def outcome(per_arm, unsound=frozenset()):
        return verdict(per_arm, arms, unsound)[:2]

    assert outcome({"ambernet": results(everything), "rc": results(everything)})[0] in ("G1", "G2")
    assert outcome({"rc": results(everything)}) == ("G2", "rc")
    assert outcome({"rc": results(set(REQUIRED_VIEN))}) == ("G3", "rc")
    assert outcome({"rc": results(set()), "mms": results(everything)}) == ("G5", None)
    assert outcome({"rc": results(set())}) == ("G4", None)
    assert outcome({"rc": results(everything, data="public-substitute")}) == ("INCOMPLETE", None)
    # An eligible arm with data missing makes it INCOMPLETE even when an
    # ineligible arm is fully measured.
    missing = results(everything)
    missing["A6.en-vi.changed"] = Result("A6.en-vi.changed", None, "", None, 0, "real")
    assert outcome({"rc": missing, "mms": results(set())}) == ("INCOMPLETE", None)
    # Unsound validation never decides.
    assert outcome({"rc": results(everything)}, frozenset({"rc"})) == ("INCOMPLETE", None)
    # Only a torch arm passes: stop and ask, with a note saying why.
    torch_arm = ArmInfo("t", "lid-model", "onnxruntime-1.27.0", needs_torch=True)
    out = verdict({"rc": results(set()), "t": results(everything)}, {**arms, "t": torch_arm})
    assert out[0] == "G5" and "torch" in out[2][0]


def test_an_arm_that_never_ran_keeps_the_verdict_provisional():
    rec = ArmInfo("rc", "recognizer", "onnxruntime-1.27.0", new_model=False)
    out = verdict({"rc": results(set())}, {"rc": rec}, planned=("rc", "ambernet"))
    assert out[:2] == ("INCOMPLETE", None) and "provisional G4" in out[2][-1]
    assert verdict({"rc": results(set())}, {"rc": rec}, planned=("rc",))[0] == "G4"


def test_one_size_of_a_sized_arm_counts_as_that_arm_run():
    rec = ArmInfo("rc", "recognizer", "onnxruntime-1.27.0", new_model=False)
    w = ArmInfo("whisper_probs_tiny", "lid-model", "onnxruntime-1.27.0")
    out = verdict({"rc": results(set()), "whisper_probs_tiny": results(set())},
                  {"rc": rec, "whisper_probs_tiny": w}, planned=("rc", "whisper_probs"))
    assert out[0] == "G4"


def test_planned_arms_match_the_runner():
    from run_bakeoff import ARMS
    assert set(PLANNED_ARMS) == set(ARMS) - {"turn_facts"}


def test_parity_failure_makes_an_arm_ineligible():
    broken = ArmInfo("ambernet", "lid-model", "onnxruntime-1.27.0", parity_passed=False)
    everything = set(REQUIRED_VIEN + REQUIRED_ZH)
    assert verdict({"ambernet": results(everything)}, {"ambernet": broken})[:2] == ("G4", None)


def test_zh_weakness_cannot_fail_the_vi_en_criteria():
    turns = [turn(i, l, bucket="<1.5", speech=800) for i, l in enumerate(["vi", "en"] * 4)]
    turns += [Turn(id=f"z{i}", audio="x", lang="zh", bucket="<1.5", speech_ms=800, channel="read", group="cv",
                   source="cv", real=False, license="x") for i in range(4)]
    lang = {t.id: t.lang for t in turns}

    def wrong_on_zh(tid, cands):
        right = lang[tid] if lang[tid] != "zh" else next(c for c in cands if c != "zh")
        return {c: (0.99 if c == right else 0.01 / (len(cands) - 1)) for c in cands}

    out = criteria(run_trials(episodes(turns), wrong_on_zh, None, Params(), None), [0.0], {})
    assert out["A2.en-vi"].passed is True
    assert out["A2.vi-zh"].passed is False


def test_a5_is_insufficient_when_silero_facts_are_missing():
    from lid_bench.scoring import noise_rejection
    noise = [Turn(id="n", audio="x", lang="noise", bucket="<1.5", speech_ms=0, channel="read", group="esc50",
                  source="esc50", real=False, license="x", noise=True)]
    assert noise_rejection(noise, {}, {}, 0.0) is None
    out = criteria([], [], {"esc50": None})
    assert out["A5"].passed is None


def test_partials_lose_the_source_prior_once_the_session_is_symmetric():
    from lid_bench.runtime_policy import LockParams, Prefix
    turns = [turn(1, "en", session="s", order=0, declared_source="vi"),
             turn(2, "en", session="s", order=1, declared_source="vi")]
    full = lambda tid, cands: {"en": 0.95, "vi": 0.05}
    prefix = lambda tid, cands: [Prefix(ms=600, speech_ms=600, probs={"en": 0.6, "vi": 0.4})]
    eps = [e for e in episodes(turns) if e.candidates == ("en", "vi")]
    trials = run_trials(eps, full, prefix, Params(source_prior_logodds=2.0), LockParams(0.8, 0))
    # Turn 1 decided with the bonus live; turn 1 was confidently en, so turn 2's
    # partial is replayed without it and locks en, not the source.
    assert trials[0].decision.bonus == 2.0 and trials[1].decision.bonus == 0.0
    assert trials[1].outcome.locked is None or trials[1].outcome.locked == "en"
    assert not trials[1].outcome.changed
