from stt_bench.hotwords import MAX_HOTWORDS, select_hotwords


def test_pairs_do_not_straddle_an_already_consumed_syllable():
    # All four syllables are hapax; the scan must yield the two adjacent pairs,
    # never the straddling middle pair.
    assert select_hotwords(["NGỌN LỬA BẠO ĐỘNG"]) == ["NGỌN LỬA", "BẠO ĐỘNG"]


def test_pair_rejected_when_either_syllable_repeats_in_the_corpus():
    # MỘT occurs in both references, so no pair containing it qualifies.
    refs = ["MỘT HAI", "MỘT BA"]
    assert select_hotwords(refs) == []


def test_repeated_syllable_does_not_block_a_later_qualifying_pair():
    refs = ["MỘT NGỌN LỬA", "MỘT BẠO ĐỘNG"]
    assert select_hotwords(refs) == ["NGỌN LỬA", "BẠO ĐỘNG"]


def test_a_repeated_phrase_disqualifies_itself():
    # The property that makes deduplication unnecessary: a phrase reachable
    # twice has both syllables occurring twice, so neither is hapax and the pair
    # is rejected. Selection therefore cannot emit a duplicate.
    assert select_hotwords(["NGỌN LỬA"]) == ["NGỌN LỬA"]
    assert select_hotwords(["NGỌN LỬA", "NGỌN LỬA"]) == []


def test_single_syllable_reference_yields_nothing():
    assert select_hotwords(["MỘT"]) == []


def test_limit_caps_the_list():
    refs = [f"A{i} B{i}" for i in range(MAX_HOTWORDS + 10)]
    assert len(select_hotwords(refs)) == MAX_HOTWORDS
    assert len(select_hotwords(refs, limit=3)) == 3
