from stt_bench.scribe_reference import reference_words, to_ref_segments


def _scribe(words):
    return {"language_code": "vie", "text": "", "words": words}


def test_reference_words_keeps_only_real_words():
    scribe = _scribe(
        [
            {"text": "[nhạc nền]", "start": 0.0, "end": 1.0, "type": "audio_event"},
            {"text": " ", "start": 1.0, "end": 1.02, "type": "spacing"},
            {"text": "Hôm", "start": 1.02, "end": 1.2, "type": "word"},
            {"text": " ", "start": 1.2, "end": 1.22, "type": "spacing"},
            {"text": "nay", "start": 1.22, "end": 1.4, "type": "word"},
            {"text": "[tiếng cười]", "start": 1.4, "end": 2.0, "type": "audio_event"},
        ]
    )
    assert reference_words(scribe) == [(1.02, 1.2, "Hôm"), (1.22, 1.4, "nay")]


def test_reference_words_drops_a_bracket_tag_even_if_typed_word():
    # Defensive: a future Scribe response could embed a tag under type=="word".
    scribe = _scribe(
        [
            {"text": "[tiếng cười]", "start": 0.0, "end": 1.0, "type": "word"},
            {"text": "được", "start": 1.0, "end": 1.2, "type": "word"},
        ]
    )
    assert reference_words(scribe) == [(1.0, 1.2, "được")]


def test_to_ref_segments_yields_only_real_words_and_no_brackets():
    scribe = _scribe(
        [
            {"text": "[nhạc nền]", "start": 0.0, "end": 1.0, "type": "audio_event"},
            {"text": " ", "start": 1.0, "end": 1.02, "type": "spacing"},
            {"text": "Hôm", "start": 1.02, "end": 1.2, "type": "word"},
            {"text": " ", "start": 1.2, "end": 1.22, "type": "spacing"},
            {"text": "nay.", "start": 1.22, "end": 1.4, "type": "word"},
            {"text": "[hiệu ứng âm thanh]", "start": 1.4, "end": 2.0, "type": "audio_event"},
        ]
    )
    segments = to_ref_segments(reference_words(scribe))
    joined_text = " ".join(s["text"] for s in segments)
    assert "[" not in joined_text
    assert joined_text == "Hôm nay."
    assert [w for s in segments for w in s["words"]] == [
        [1.02, 1.2, "Hôm"],
        [1.22, 1.4, "nay."],
    ]


def test_to_ref_segments_splits_on_gap():
    words = [(0.0, 0.5, "a"), (5.0, 5.5, "b")]
    segments = to_ref_segments(words, gap=0.3, max_s=8.0)
    assert len(segments) == 2
    assert segments[0]["text"] == "a"
    assert segments[1]["text"] == "b"


def test_to_ref_segments_keeps_within_gap_words_together():
    words = [(0.0, 0.5, "a"), (0.6, 1.0, "b")]
    segments = to_ref_segments(words, gap=0.3, max_s=8.0)
    assert len(segments) == 1
    assert segments[0]["text"] == "a b"
