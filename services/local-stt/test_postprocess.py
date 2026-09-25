"""Unit tests for engine text post-processing. No model weights required."""
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
