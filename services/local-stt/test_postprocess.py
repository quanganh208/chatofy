"""Unit tests for engine text post-processing. No model weights required."""
from engines.moonshine_en import MoonshineEn
from engines.parakeet_runtime import strip_language_tags, strip_language_tags_delta
from engines.zipformer_vi import ZipformerVi


def test_vi_uppercase_becomes_sentence_case():
    # Raw decoder output looks exactly like this — see
    # benchmarks/stt/results/r1/sherpa-zipformer-vi.jsonl
    raw = "NGỌN LỬA BẠO ĐỘNG Ở TRUNG ĐÔNG VÀ PHÁ VỠ LỘ TRÌNH HÒA BÌNH"
    assert (
        ZipformerVi().postprocess(raw)
        == "Ngọn lửa bạo động ở trung đông và phá vỡ lộ trình hòa bình"
    )


def test_vi_lowercasing_preserves_diacritics():
    assert ZipformerVi().postprocess("ĐI ĐÂU ĐẤY") == "Đi đâu đấy"


def test_vi_empty_transcript_stays_empty():
    # Silence decodes to an empty string; indexing must not blow up.
    assert ZipformerVi().postprocess("") == ""
    assert ZipformerVi().postprocess("   ") == ""


def test_en_output_is_left_alone():
    # Moonshine already emits sentence case with punctuation.
    raw = "The rector did not ask for a catechism."
    assert MoonshineEn().postprocess(raw) == raw


def test_a_delta_keeps_the_space_that_starts_a_word():
    # The caller appends this verbatim, so a trimmed leading space glues the
    # word onto the previous one: "làm" + "người" -> "làmngười". That reached
    # translation and synthesis, and cost 421 commit contradictions on one turn.
    assert strip_language_tags_delta(" người dân") == " người dân"
    assert strip_language_tags(" người dân") == "người dân"


def test_a_delta_still_loses_its_language_tags():
    # The only thing the two forms must agree on: a tag is never spoken.
    assert strip_language_tags_delta(" ba <vi-VN> bốn") == " ba bốn"
    assert "<" not in strip_language_tags_delta("một <en-US>")


def test_a_delta_that_is_only_a_tag_does_not_become_a_word_break():
    # It collapses to whitespace, which appends harmlessly. Returning "" instead
    # would be safe too; returning "  " would not, and this pins which it is.
    assert strip_language_tags_delta("<vi-VN>").strip() == ""
