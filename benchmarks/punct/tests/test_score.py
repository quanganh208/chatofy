from punct_bench.score import metrics, row_counts
from punct_bench.text import model_input, tokens


def test_tokens_reduce_marks_to_three_classes():
    assert tokens("Vâng! Anh: ổn chứ?") == [("Vâng", "."), ("Anh", ","), ("ổn", ""), ("chứ", "?")]


def test_model_input_is_lowercase_words_only():
    assert model_input("Xin chào, OpenAI.") == "xin chào openai"


def test_a_capital_after_a_comma_counts_as_mid_sentence():
    ref = "Vâng, xin chào anh Tuấn. Anh xin kính chào quý vị."
    pred = "Vâng, xin chào Anh Tuấn. Anh, Xin kính chào quý vị."
    c = row_counts(ref, pred, model_input(ref))
    # "Anh" before Tuấn and "Xin" are capitals the reference does not have,
    # and neither opens a sentence in the prediction.
    assert c["mid_caps"] == 2
    assert c["fp,"] == 1
    assert c["word_changed"] == 0


def test_a_perfect_prediction_scores_one():
    ref = "Mô hình AI của OpenAI ở Hà Nội, phải không?"
    m = metrics(row_counts(ref, ref, model_input(ref)))
    assert m["punct_f1"] == 1.0 and m["case_f1"] == 1.0
    assert m["ai"] == "1/1" and m["proper_nouns"] == "4/4"  # AI, OpenAI, Hà, Nội: counted per word


def test_writing_ai_for_who_is_a_false_ai():
    c = row_counts("Ai đang nói vậy?", "AI đang nói vậy?", "ai đang nói vậy")
    assert c["false_ai"] == 1 and c["ai_ok"] == 0


def test_a_merged_word_is_a_word_change():
    c = row_counts("năm g", "5G", "năm g")
    assert c["word_changed"] == 1


def test_a_word_changing_row_is_scored_as_the_fallback_prod_shows():
    ref = "Năm năm trước, tôi ở Hà Nội."
    changed = row_counts(ref, "5 năm trước, tôi ở Hà Nội.", "năm năm trước tôi ở hà nội")
    fallback = row_counts(ref, "Năm năm trước tôi ở hà nội.", "năm năm trước tôi ở hà nội")
    assert changed["word_changed"] == 1
    assert {k: v for k, v in changed.items() if k != "word_changed"} == {
        k: v for k, v in fallback.items() if k != "word_changed"
    }


def test_post_rules_lower_the_greeting_and_keep_the_names():
    from punct_bench.post_rules import apply

    text = "Vâng, xin chào Anh Tuấn. Anh, Xin kính chào quý vị ở Hoàng Anh Tuấn, Hà Nội và AI."
    assert apply(text, {"comma", "title"}) == (
        "Vâng, xin chào anh Tuấn. Anh, xin kính chào quý vị ở Hoàng Anh Tuấn, Hà Nội và AI."
    )


def test_comma_common_lowers_a_common_word_but_not_a_foreign_name():
    from punct_bench.post_rules import apply

    assert apply("Anh, Xin kính chào ở Đức, Berlin rất đẹp.", {"comma-common"}) == (
        "Anh, xin kính chào ở Đức, Berlin rất đẹp."
    )


def test_comma_rules_drop_the_greeting_and_opening_title_commas_only():
    from punct_bench.post_rules import apply

    text = "Vâng, xin chào, anh Tuấn. Anh, xin kính chào. Hôm nay, anh đến."
    assert apply(text, {"greet-comma", "title-comma"}) == (
        "Vâng, xin chào anh Tuấn. Anh xin kính chào. Hôm nay, anh đến."
    )
