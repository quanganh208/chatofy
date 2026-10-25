from lid_bench.runtime_policy import LockParams, Prefix, replay

LOCK = LockParams(tau_lock=0.9, lock_min_speech_ms=500)


def p(ms, vi, speech=None, latency=0.0):
    return Prefix(ms=ms, speech_ms=ms if speech is None else speech, probs={"vi": vi, "en": 1 - vi},
                  latency_ms=latency)


def test_locks_on_first_confident_prefix_with_enough_speech():
    out = replay([p(600, 0.95, speech=400), p(900, 0.95), p(1200, 0.2)], "vi", "vi", 0.0, LOCK)
    # 600 is confident but has too little speech; 900 locks; 1200's flip is ignored.
    assert out.locked == "vi" and out.lock_ms == 900
    assert not out.changed and not out.final_overruled_lock


def test_final_overruling_the_lock_counts_as_a_change():
    out = replay([p(600, 0.95), p(900, 0.95)], "en", "vi", 0.0, LOCK)
    assert out.locked == "vi" and out.final == "en"
    assert out.final_overruled_lock and out.changed


def test_no_language_is_shown_before_the_lock_so_early_flips_are_not_changes():
    out = replay([p(600, 0.6), p(900, 0.3), p(1200, 0.02)], "en", "vi", 0.0, LOCK)
    # 600 and 900 disagree, but neither is shown; 1200 locks en and the final agrees.
    assert out.locked == "en" and out.lock_ms == 1200
    assert not out.changed and out.first_language_ms == 1200


def test_a_turn_that_never_locks_shows_its_language_at_the_final():
    out = replay([p(600, 0.6), p(900, 0.3)], "en", "vi", 0.0, LOCK, final_ms=4320)
    assert out.locked is None and not out.changed
    assert out.first_language_ms == 4320 and out.had_partials


def test_source_prior_can_be_what_makes_a_prefix_confident():
    weak = [p(600, 0.8)]
    assert replay(weak, "vi", "vi", 0.0, LOCK).locked is None
    assert replay(weak, "vi", "vi", 1.0, LOCK).locked == "vi"


def test_first_language_time_is_the_lock_and_includes_decision_latency():
    out = replay([p(900, 0.95, latency=120.0), p(600, 0.5, latency=80.0)], "vi", "vi", 0.0, LOCK)
    assert out.first_language_ms == 1020.0


def test_turn_shorter_than_every_prefix_shows_only_the_final():
    out = replay([], "vi", "vi", 0.0, LOCK)
    assert out.first_language_ms is None and not out.changed
