from lid_bench.parity import MAX_DELTA, PARITY_CLIPS, compare


def clips(n, delta=0.0):
    reference = {f"c{i}": {"vi": 0.7, "en": 0.2, "zh": 0.1} for i in range(n)}
    runtime = {f"c{i}": {"vi": 0.7 - delta, "en": 0.2 + delta, "zh": 0.1} for i in range(n)}
    return reference, runtime


def test_identical_runtimes_pass():
    report = compare(*clips(PARITY_CLIPS))
    assert report.passed and report.max_delta == 0.0


def test_a_delta_over_the_bound_fails_and_names_the_clip():
    reference, runtime = clips(PARITY_CLIPS)
    runtime["c7"] = {"vi": 0.6, "en": 0.3, "zh": 0.1}
    report = compare(reference, runtime)
    assert not report.passed
    assert report.worst_id == "c7"
    assert report.max_delta > MAX_DELTA


def test_too_few_shared_clips_fail_even_when_identical():
    assert not compare(*clips(PARITY_CLIPS - 1)).passed


def test_argmax_flips_are_counted():
    reference, runtime = clips(PARITY_CLIPS)
    runtime["c0"] = {"vi": 0.2, "en": 0.7, "zh": 0.1}
    assert compare(reference, runtime).argmax_disagreements == 1
