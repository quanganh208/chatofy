"""Unit tests for engine text post-processing. No model weights required."""
from engines.paraformer_zh import ParaformerZh
from engines.parakeet_en import ParakeetEn
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
    # Parakeet already emits sentence case with punctuation.
    raw = "The rector did not ask for a catechism."
    assert ParakeetEn().postprocess(raw) == raw


def test_en_filler_only_transcript_is_no_speech():
    # What Parakeet returns for a cough, a knock, or digital silence — see FILLERS.
    for raw in ("Uh", "Mm.", "Mm-hmm.", "Hmm?", "Uh, um."):
        assert ParakeetEn().postprocess(raw) == "", raw


def test_en_fillers_inside_speech_are_kept():
    for raw in ("Uh, I think so.", "Yeah.", "Okay.", "Mm, maybe tomorrow."):
        assert ParakeetEn().postprocess(raw) == raw


def test_zh_spaces_between_han_characters_are_dropped():
    assert ParaformerZh().postprocess("我们 明天 去 北京") == "我们明天去北京"


def test_zh_spaces_around_latin_tokens_are_kept():
    # Paraformer's own output for an English standard name inside zh speech —
    # see benchmarks/stt/results/r11-zh-fleurs/sherpa-paraformer-zh.jsonl
    raw = "它能向后兼容八零二点一一 a 八零二点一一 b"
    assert ParaformerZh().postprocess(raw) == raw


def test_zh_empty_transcript_stays_empty():
    assert ParaformerZh().postprocess("  ") == ""
