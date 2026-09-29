import random

from stt_bench.oracle_segments import segments


def _ref_from_words(words):
    """Wrap a flat [(start, end, text), ...] list as a single ref segment,
    the shape `segments()` flattens internally (`ref = [{..., "words": [...]}]`)."""
    return [{"text": "", "words": [[s, e, t] for s, e, t in words]}]


def _random_ref(seed, n_words=40):
    rng = random.Random(seed)
    words = []
    t = 0.0
    for i in range(n_words):
        # Random gap: mostly small (within-turn), sometimes a real pause.
        t += rng.choice([0.05, 0.08, 0.1, 0.4, 0.6, 1.2])
        dur = rng.uniform(0.05, 0.3)
        words.append((t, t + dur, f"w{i}"))
        t += dur
    return words


def test_no_overlap_on_random_ref_lists():
    for seed in range(20):
        words = _random_ref(seed)
        segs = segments(_ref_from_words(words))
        for i in range(len(segs) - 1):
            assert segs[i][1] <= segs[i + 1][0], f"seed={seed} i={i} {segs[i]} vs {segs[i + 1]}"


def test_no_overlap_on_cap_split():
    # Contiguous words (no gap >= 0.3) that exceed max_s: must split at the
    # cap, with a zero raw gap at the split (the boundary collapses to the
    # word edge).
    words = []
    t = 0.0
    for i in range(30):
        words.append((t, t + 0.3, f"w{i}"))
        t += 0.3  # back-to-back, no silence
    segs = segments(_ref_from_words(words), max_s=2.0, gap=0.3)
    assert len(segs) > 1
    for i in range(len(segs) - 1):
        assert segs[i][1] <= segs[i + 1][0]


def test_every_word_midpoint_falls_in_exactly_one_segment():
    for seed in range(20):
        words = _random_ref(seed)
        segs = segments(_ref_from_words(words))
        for start, end, _ in words:
            mid = (start + end) / 2
            covering = [s for s in segs if s[0] <= mid <= s[1]]
            assert len(covering) == 1, f"seed={seed} word=({start},{end}) covered by {covering}"


def test_isolated_word_keeps_full_padding():
    words = [(5.0, 5.5, "solo")]
    segs = segments(_ref_from_words(words), pad_before=0.15, pad_after=0.25)
    assert segs == [(5.0 - 0.15, 5.5 + 0.25)]


def test_isolated_word_padding_clamped_at_zero():
    words = [(0.05, 0.2, "early")]
    segs = segments(_ref_from_words(words), pad_before=0.15, pad_after=0.25)
    assert segs == [(0.0, 0.2 + 0.25)]


def test_cap_split_boundary_is_word_edge_when_gap_is_zero():
    # Two words touching exactly (no gap) that get split by the max_s cap.
    words = [(0.0, 1.0, "a"), (1.0, 3.5, "b")]
    segs = segments(_ref_from_words(words), max_s=2.0, gap=0.3)
    assert len(segs) == 2
    # boundary = midpoint of (raw_end_a=1.0, raw_start_b=1.0) == 1.0 (the word edge)
    assert segs[0][1] == 1.0
    assert segs[1][0] == 1.0
