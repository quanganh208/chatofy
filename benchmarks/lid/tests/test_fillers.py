from lid_bench.fillers import is_filler_only


def test_zh_fillers_and_tags_are_no_language():
    assert is_filler_only("嗯", "zh")
    assert is_filler_only("嗯嗯嗯", "zh")
    assert is_filler_only("呃 [UNK]", "zh")
    assert is_filler_only("哦。", "zh")


def test_zh_words_with_meaning_count():
    assert not is_filler_only("对", "zh")
    assert not is_filler_only("好的", "zh")
    assert not is_filler_only("嗯然后", "zh")
    assert not is_filler_only("嗯 okay", "zh")


def test_en_backchannel_noises_are_no_language():
    assert is_filler_only("MM HMM", "en")
    assert is_filler_only("UM", "en")
    assert is_filler_only("<LAUGH>", "en")
    assert is_filler_only("uh, hmm...", "en")


def test_en_words_with_meaning_count():
    assert not is_filler_only("YEAH", "en")
    assert not is_filler_only("OKAY", "en")
    assert not is_filler_only("<LAUGH> YEAH", "en")
    assert not is_filler_only("UM JAPAN", "en")


def test_vi_fillers_and_words():
    assert is_filler_only("ừ", "vi")
    assert is_filler_only("Ờ à", "vi")
    assert not is_filler_only("dạ", "vi")
    assert not is_filler_only("vâng ạ", "vi")
    assert not is_filler_only("ừ đúng rồi", "vi")


def test_unknown_transcripts_are_not_guessed():
    assert is_filler_only(None, "en") is None
    assert is_filler_only("IGNORE_TIME_SEGMENT_IN_SCORING", "en") is None
    assert is_filler_only("<FOREIGN>", "en") is False
